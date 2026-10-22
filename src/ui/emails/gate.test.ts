import { describe, expect, it } from 'vitest';
import { ALLOW_OWNER_SENDS, gateNotifier, nextSendStep, OWNER_SENDS_OFF, parseAllowFlag, sendGate, type GateInput, type SendStep } from './gate';
import { createDemoNotifier } from './demo-notifier';
import { createGroupNotifier, CREATE_GROUP_PRIVILEGE, WritesDisabled, READ_ONLY_NOTE } from '../../notify';
import type { RequestFn } from '../../scan/types';

const base: GateInput = { demo: false, allowOwnerSends: true, writable: true, canCreate: true, owners: 3 };

describe('the build switch', () => {
  it('is off unless exactly "true"', () => {
    expect(parseAllowFlag(undefined)).toBe(false);
    expect(parseAllowFlag('')).toBe(false);
    expect(parseAllowFlag('1')).toBe(false);
    expect(parseAllowFlag('TRUE')).toBe(false);
    expect(parseAllowFlag('true')).toBe(true);
  });
  it('is off in the test build', () => {
    expect(ALLOW_OWNER_SENDS).toBe(false);
  });
});

describe('send gate', () => {
  it('allows both with the switch on, a writable org and the privilege', () => {
    expect(sendGate(base)).toEqual({ test: { ok: true }, owners: { ok: true } });
  });
  it('blocks owner sends when VITE_ALLOW_OWNER_SENDS is off, but not the test', () => {
    const g = sendGate({ ...base, allowOwnerSends: false });
    expect(g.test.ok).toBe(true);
    expect(g.owners).toEqual({ ok: false, reason: 'owner-sends-off', message: OWNER_SENDS_OFF });
  });
  it('blocks both when the org is not writable', () => {
    const g = sendGate({ ...base, writable: false });
    expect(g.test).toMatchObject({ ok: false, reason: 'read-only', message: READ_ONLY_NOTE });
    expect(g.owners.ok).toBe(false);
  });
  it('blocks both without the privilege, and while it is being checked', () => {
    expect(sendGate({ ...base, canCreate: false }).owners.reason).toBe('no-privilege');
    expect(sendGate({ ...base, canCreate: null }).test.reason).toBe('checking');
  });
  it('blocks both with nobody ticked', () => {
    expect(sendGate({ ...base, owners: 0 }).test.reason).toBe('nobody');
    expect(sendGate({ ...base, owners: 0 }).owners.ok).toBe(false);
  });
  it('the demo (in-memory fake) may show owner sends with the switch off', () => {
    expect(sendGate({ ...base, demo: true, allowOwnerSends: false, writable: false }).owners.ok).toBe(true);
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
    const g = sendGate({ ...base, demo: true, allowOwnerSends: false, writable: false, adminEmail: 'you@example.org' });
    expect(g.test.ok).toBe(true);
    expect(g.owners.ok).toBe(true);
  });
  it('owner sends stay behind their own switches, not the admin email', () => {
    expect(sendGate({ ...base, adminEmail: '' }).owners.ok).toBe(true);
    expect(sendGate({ ...base, adminEmail: '', allowOwnerSends: false }).owners.reason).toBe('owner-sends-off');
  });
  it('a read-only org still says read-only first', () => {
    expect(sendGate({ ...base, writable: false, adminEmail: '' }).test.reason).toBe('read-only');
  });
});

describe('confirm gating', () => {
  const open = sendGate(base), shut = sendGate({ ...base, allowOwnerSends: false });
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
