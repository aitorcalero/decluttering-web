import { describe, expect, it } from 'vitest';
import { gateNotifier, NOT_OPTED_IN, nextSendStep, OWNER_SENDS_OFF, SENDING_UNAVAILABLE, TEST_FIRST, sendGate, type GateInput, type SendStep } from './gate';
import { DAY_FULL } from './limits';
import { createDemoNotifier } from './demo-notifier';
import { createGroupNotifier, CREATE_GROUP_PRIVILEGE, WritesDisabled } from '../../notify';
import type { RequestFn } from '../../scan/types';

/** An org that may opt in, an admin who has, and owner sends unlocked (the unlock itself is DC-125b's). */
const base: GateInput = { demo: false, ownerSendsUnlocked: true, mayOptIn: true, optedIn: true, canCreate: true, owners: 3 };

describe('send gate', () => {
  it('allows both with an org that may opt in, an opted-in admin, the privilege and the unlock', () => {
    expect(sendGate(base)).toEqual({ test: { ok: true }, owners: { ok: true } });
  });
  it('owner sends stay locked until unlocked, but the test is allowed', () => {
    const g = sendGate({ ...base, ownerSendsUnlocked: false });
    expect(g.test.ok).toBe(true);
    expect(g.owners).toEqual({ ok: false, reason: 'test-first', message: TEST_FIRST });
  });
  it('blocks both when no org may opt in (off, or an unlisted org), with the calm line', () => {
    const g = sendGate({ ...base, mayOptIn: false });
    expect(g.test).toMatchObject({ ok: false, reason: 'read-only', message: SENDING_UNAVAILABLE });
    expect(g.owners.ok).toBe(false);
    expect(SENDING_UNAVAILABLE).toBe('Sending isn’t available on this site yet. You can still review everything and write the emails.');
  });
  it('an org that may opt in, not yet opted in: no test, no owner sends, and it says to turn sending on', () => {
    const g = sendGate({ ...base, optedIn: false });
    expect(g.test).toEqual({ ok: false, reason: 'not-opted-in', message: NOT_OPTED_IN });
    expect(g.owners.ok).toBe(false);
    expect(g.owners.reason).toBe('not-opted-in');
  });
  it('opted in allows the test send', () => {
    expect(sendGate({ ...base, optedIn: true, ownerSendsUnlocked: false }).test).toEqual({ ok: true });
  });
  it('owner sends are locked in every state while the lock is false', () => {
    for (const mayOptIn of [true, false]) for (const optedIn of [true, false]) for (const canCreate of [true, false, null]) {
      expect(sendGate({ ...base, mayOptIn, optedIn, canCreate, ownerSendsUnlocked: false }).owners.ok).toBe(false);
    }
  });
  it('a non-boolean-true lock stays locked (fail closed)', () => {
    expect(sendGate({ ...base, ownerSendsUnlocked: 'true' as never }).owners.ok).toBe(false);
    expect(sendGate({ ...base, ownerSendsUnlocked: undefined as never }).owners.ok).toBe(false);
  });
  it('blocks both without the privilege, and while it is being checked', () => {
    expect(sendGate({ ...base, canCreate: false }).owners.reason).toBe('no-privilege');
    expect(sendGate({ ...base, canCreate: null }).test.reason).toBe('checking');
  });
  it('blocks both with nobody ticked', () => {
    expect(sendGate({ ...base, owners: 0 }).test.reason).toBe('nobody');
    expect(sendGate({ ...base, owners: 0 }).owners.ok).toBe(false);
  });
  it('the demo (in-memory fake) shows as opted in and may show owner sends while locked', () => {
    expect(sendGate({ ...base, demo: true, ownerSendsUnlocked: false, mayOptIn: false, optedIn: false }).owners.ok).toBe(true);
  });
});

describe('send gate: the daily limit (DC-125d)', () => {
  it('allows owner sends under the limit and blocks them at it, with the reason', () => {
    expect(sendGate({ ...base, sentToday: 99 }).owners).toEqual({ ok: true });
    expect(sendGate({ ...base, sentToday: 100 }).owners).toEqual({ ok: false, reason: 'daily-limit', message: DAY_FULL });
    expect(sendGate({ ...base, sentToday: 250 }).owners.reason).toBe('daily-limit');
  });
  it('never blocks the test to yourself, and the demo shows the same limit', () => {
    expect(sendGate({ ...base, sentToday: 100 }).test).toEqual({ ok: true });
    expect(sendGate({ ...base, demo: true, sentToday: 100 }).owners.reason).toBe('daily-limit');
  });
  it('an unknown count (not given) blocks nothing; a junk count blocks', () => {
    expect(sendGate(base).owners.ok).toBe(true);
    expect(sendGate({ ...base, sentToday: Number.NaN }).owners.reason).toBe('daily-limit');
  });
  it('test-first still comes first', () => {
    expect(sendGate({ ...base, ownerSendsUnlocked: false, sentToday: 100 }).owners.reason).toBe('test-first');
  });
});

describe('send gate: the admin email (DC-121)', () => {
  const MSG = 'Your ArcGIS Online profile has no email address, so a test has nowhere to go. Add one in your profile, then come back.';
  it('blocks the test when the profile has no email (empty or whitespace)', () => {
    for (const adminEmail of ['', '   ']) {
      expect(sendGate({ ...base, adminEmail }).test).toEqual({ ok: false, reason: 'no-email', message: MSG });
    }
  });
  it('passes the test with an email on file', () => {
    expect(sendGate({ ...base, adminEmail: 'me@example.org' }).test).toEqual({ ok: true });
  });
  it('an unknown email (not supplied) does not block', () => {
    expect(sendGate(base).test.ok).toBe(true);
  });
  it('the demo admin has an email, so the demo is unaffected', () => {
    const g = sendGate({ ...base, demo: true, ownerSendsUnlocked: false, mayOptIn: false, optedIn: false, adminEmail: 'you@example.org' });
    expect(g.test.ok).toBe(true);
    expect(g.owners.ok).toBe(true);
  });
  it('owner sends stay behind their own switches, not the admin email', () => {
    expect(sendGate({ ...base, adminEmail: '' }).owners.ok).toBe(true);
    expect(sendGate({ ...base, adminEmail: '', ownerSendsUnlocked: false }).owners.reason).toBe('test-first');
  });
  it('a read-only org still says read-only first', () => {
    expect(sendGate({ ...base, mayOptIn: false, adminEmail: '' }).test.reason).toBe('read-only');
  });
});

describe('confirm gating', () => {
  const open = sendGate(base), shut = sendGate({ ...base, ownerSendsUnlocked: false });
  const walk = (events: Parameters<typeof nextSendStep>[1][], gate = open) => events.reduce<SendStep>((s, e) => nextSendStep(s, e, gate), 'compose');
  it('sending starts only after ask and confirm', () => {
    expect(walk([{ type: 'confirm' }])).toBe('compose');
    expect(walk([{ type: 'ask' }])).toBe('confirming');
    expect(walk([{ type: 'ask' }, { type: 'confirm' }])).toBe('sending');
    expect(walk([{ type: 'ask' }, { type: 'cancel' }, { type: 'confirm' }])).toBe('compose');
  });
  it('a closed gate never reaches sending', () => {
    expect(walk([{ type: 'ask' }, { type: 'confirm' }], shut)).toBe('compose');
    expect(nextSendStep('confirming', { type: 'confirm' }, shut)).toBe('compose');
  });
  it('done goes back to compose only on "again"', () => {
    expect(walk([{ type: 'ask' }, { type: 'confirm' }, { type: 'finished' }])).toBe('done');
    expect(nextSendStep('done', { type: 'again' }, open)).toBe('compose');
  });
});

describe('the gated notifier', () => {
  it('with owner sends off: no add, no owner notify, no sendToOwner, and no request for them', async () => {
    const d = createDemoNotifier({ self: 'me_admin' });
    const n = gateNotifier(d.notifier, false);
    await n.createGroup();
    const before = d.calls.length;
    await expect(n.sendToOwner('owner_1', 's', '<p>h</p>')).rejects.toThrow(OWNER_SENDS_OFF);
    await expect(n.add(['owner_1'])).rejects.toThrow(OWNER_SENDS_OFF);
    await expect(n.notify(['owner_1'], 's', 'h')).rejects.toThrow(OWNER_SENDS_OFF);
    await expect(n.notify(['me_admin', 'owner_1'], 's', 'h')).rejects.toThrow(OWNER_SENDS_OFF);
    expect(d.calls.slice(before)).toEqual([]);
  });
  it('with owner sends off: the test still goes to the signed-in admin only', async () => {
    const d = createDemoNotifier({ self: 'me_admin' });
    const n = gateNotifier(d.notifier, false);
    await n.createGroup();
    const rec = await n.sendTest('[Test] hi', '<p>x</p>');
    expect(rec.to).toEqual(['me_admin']);
    expect(d.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['community/createGroup', 'community/groups/<g>/createNotification']);
    expect(d.calls.at(-1)!.users).toBe('me_admin');
  });
  it('with owner sends on: add -> notify -> remove per owner', async () => {
    const d = createDemoNotifier({ self: 'me_admin' });
    const n = gateNotifier(d.notifier, true);
    await n.createGroup();
    const r = await n.sendToOwner('owner_1', 's', '<p>h</p>');
    expect(r).toMatchObject({ sent: true, notRemoved: [] });
    expect(d.calls.filter((c) => c.method === 'POST').map((c) => c.path.split('/').pop())).toEqual(['createGroup', 'addUsers', 'createNotification', 'removeUsers']);
    expect(d.members.size).toBe(0);
  });
  it('a non-writable org gets no notifier at all', () => {
    const request: RequestFn = async () => { throw new Error('no request may be made'); };
    expect(() => createGroupNotifier({ request, orgId: 'OtherOrg12345678', writableOrgIds: ['DevOrg0123456789'] })).toThrow(WritesDisabled);
  });
  it('the demo reuses its group rather than creating a second one', async () => {
    const d = createDemoNotifier({ self: 'me_admin', groupExists: true });
    const g = await d.notifier.createGroup();
    expect(g.reused).toBe(true);
    expect(d.calls.some((c) => c.path === 'community/createGroup')).toBe(false);
  });
  it('the demo reports a missing privilege', async () => {
    const d = createDemoNotifier({ self: 'me_admin', canCreateGroup: false });
    expect((await d.notifier.canCreateGroup()).ok).toBe(false);
    expect(CREATE_GROUP_PRIVILEGE).toBe('portal:user:createGroup');
  });
});

describe('the lock is read at every call (the DC-125b seam)', () => {
  it('a function lock opens and closes live; a non-true value stays locked', async () => {
    const d = createDemoNotifier({ self: 'me_admin' });
    let open = false;
    const n = gateNotifier(d.notifier, () => open);
    await n.createGroup();
    await expect(n.sendToOwner('owner_1', 's', '<p>h</p>')).rejects.toThrow(OWNER_SENDS_OFF);
    open = true;
    expect(await n.sendToOwner('owner_1', 's', '<p>h</p>')).toMatchObject({ sent: true });
    open = false;
    await expect(n.add(['owner_1'])).rejects.toThrow(OWNER_SENDS_OFF);
    const loose = gateNotifier(d.notifier, (() => 'yes') as never);
    await expect(loose.add(['owner_1'])).rejects.toThrow(OWNER_SENDS_OFF);
  });
});

describe('tidying the group under the gate (DC-068)', () => {
  it('runs with owner sends off: removes leftovers, never adds anyone', async () => {
    const d = createDemoNotifier({ self: 'me_admin', leftover: ['old_1', 'old_2'] });
    const n = gateNotifier(d.notifier, false);
    await n.createGroup();
    const before = d.calls.length;
    expect(await n.tidyGroup()).toEqual({ removed: ['old_1', 'old_2'], notRemoved: [] });
    expect(d.members.size).toBe(0);
    expect(d.calls.slice(before).filter((c) => c.method === 'POST').map((c) => c.path.split('/').pop())).toEqual(['removeUsers']);
  });
});

describe('DC-017: the nudge log with owner sends off', () => {
  it('finds and reads, but never creates or writes', async () => {
    const { createFakeLogOrg, createNudgeLog, FAKE_PORTAL } = await import('../../log');
    const { gateNudgeLog, OwnerSendsOff } = await import('./gate');
    const fake = createFakeLogOrg({ self: 'me', orgId: 'org1' });
    const real = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: 'org1', writableOrgIds: ['org1'] });
    const off = gateNudgeLog(real, false);
    expect(await off.find()).toBeNull();
    expect(await off.read()).toEqual(new Map());
    await expect(off.create()).rejects.toBeInstanceOf(OwnerSendsOff);
    await expect(off.record({ owner: 'me', sentAt: 1, itemIds: [], credits: 0, sender: 'me' })).rejects.toBeInstanceOf(OwnerSendsOff);
    expect(fake.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(gateNudgeLog(real, true)).toBe(real);
  });

  it('still lets the admin delete the app own log with owner sends off (ADR 0012)', async () => {
    const { createFakeLogOrg, createNudgeLog, FAKE_PORTAL } = await import('../../log');
    const { gateNudgeLog } = await import('./gate');
    const fake = createFakeLogOrg({ self: 'me', orgId: 'org1', exists: true });
    const real = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: 'org1', writableOrgIds: ['org1'] });
    const off = gateNudgeLog(real, false);
    await off.find();
    expect(await off.deleteLog()).toBe('deleted');
    expect(fake.deleted).toBe(1);
  });
});
