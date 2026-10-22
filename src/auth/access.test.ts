import { describe, expect, it } from 'vitest';
import { ADMIN_PRIVILEGES, CAPABILITY_SUMMARY, NO_ADMIN_EMAIL, SEND_PRIVILEGES, accessMode, canSeeUsage, capabilities, emailCapability, privilegesOfMode } from './access';

describe('emailCapability (DC-121)', () => {
  it('is ticked and shows the address when one is on file', () => {
    expect(emailCapability(' me@example.org ')).toEqual({ id: 'email', state: 'yes', label: 'Your email address', line: 'me@example.org' });
  });
  it('is unticked with the how-to message when there is none', () => {
    for (const e of ['', '  ']) expect(emailCapability(e)).toEqual({ id: 'email', state: 'no', label: 'Your email address', line: NO_ADMIN_EMAIL });
  });
  it('is left out while the address is not known', () => {
    expect(emailCapability(undefined)).toBeNull();
  });
});

const VIEW = ['portal:admin:viewItems', 'portal:admin:viewUsers'];
const SEND = ['portal:user:createGroup', 'portal:admin:assignToGroups'];

describe('accessMode', () => {
  it('is admin with view, group create and assign privileges and readable usage', () => {
    expect(accessMode([...VIEW, ...SEND], true)).toBe('admin');
  });
  it('is admin-cant-send without group creation', () => {
    expect(accessMode([...VIEW, 'portal:admin:assignToGroups'], true)).toBe('admin-cant-send');
  });
  it('is admin-cant-send without group assignment', () => {
    expect(accessMode([...VIEW, 'portal:user:createGroup'], true)).toBe('admin-cant-send');
  });
  it('is admin-cant-send with view privileges only', () => {
    expect(accessMode(VIEW, true)).toBe('admin-cant-send');
  });
  it('is my-items for a plain member', () => {
    expect(accessMode(['portal:user:createItem', 'portal:user:createGroup'], true)).toBe('my-items');
  });
  it('is my-items when viewItems or viewUsers is missing', () => {
    expect(accessMode(['portal:admin:viewItems', ...SEND], true)).toBe('my-items');
    expect(accessMode(['portal:admin:viewUsers', ...SEND], true)).toBe('my-items');
  });
  it('keeps the admin flow when usage is not readable (ADR 0008, no-usage mode)', () => {
    expect(accessMode([...VIEW, ...SEND], false)).toBe('admin');
    expect(accessMode([...VIEW], false)).toBe('admin-cant-send');
  });
  it('is my-items with no privileges', () => {
    expect(accessMode([], true)).toBe('my-items');
  });
  it('treats a missing privileges list as my-items', () => {
    expect(accessMode(undefined as unknown as string[], true)).toBe('my-items');
  });
  it('ignores unrelated custom-role privileges', () => {
    expect(accessMode([...VIEW, ...SEND, 'portal:user:viewHostedFeatures', 'custom:thing'], true)).toBe('admin');
  });
  it('exposes the confirmed privilege sets', () => {
    expect(ADMIN_PRIVILEGES).toEqual(VIEW);
    expect(SEND_PRIVILEGES).toEqual(SEND);
  });
});

describe('canSeeUsage', () => {
  it('follows the probe result', () => {
    expect(canSeeUsage(true)).toBe(true);
    expect(canSeeUsage(false)).toBe(false);
  });
});

describe('capabilities (DC-111)', () => {
  const view = [...ADMIN_PRIVILEGES], send = [...SEND_PRIVILEGES];
  const ids = (c: ReturnType<typeof capabilities>) => Object.fromEntries(c.items.map((i) => [i.id, i.state]));
  const cases: Array<[string, string[], boolean, boolean]> = [];
  for (const [n, p] of [['none', []], ['view', view], ['send', send], ['both', [...view, ...send]]] as const)
    for (const u of [false, true]) for (const w of [false, true]) cases.push([n, [...p], u, w]);

  it.each(cases)('privileges %s, usage %s, writable %s', (_n, p, u, w) => {
    const c = capabilities(p, u, w);
    const v = view.every((x) => p.includes(x)), s = send.every((x) => p.includes(x));
    expect(ids(c)).toEqual({ view: v ? 'yes' : 'no', usage: u ? 'yes' : 'no', send: s ? 'yes' : 'no', 'org-send': w ? 'yes' : 'neutral' });
    expect(c.level).toBe(!v ? 'mine' : s && w ? 'full' : s ? 'locked' : 'review');
    expect(c.summary).toBe(CAPABILITY_SUMMARY[c.level]);
    expect(c.items.every((i) => i.label && i.line)).toBe(true);
  });

  it('has a summary line for each mode', () => {
    expect(capabilities([...view, ...send], true, true).summary).toBe('You’re all set: full review and sending.');
    expect(capabilities(view, true, true).summary).toBe('Review only: you can look through the whole org, but not send nudges.');
    expect(capabilities([...view, ...send], true, false).summary).toBe('Review only for now: your account could send, but sending is switched off for this org.');
    expect(capabilities(undefined, false, true).summary).toMatch(/^Your own layers/);
  });

  it('a read-only org is neutral, not a failure', () => {
    expect(capabilities([...view, ...send], true, false).items.find((i) => i.id === 'org-send')).toMatchObject({ state: 'neutral', label: 'Sending in this org', line: 'Switched off here for now: this org is review-only.' });
    expect(capabilities([...view, ...send], true, true).items.find((i) => i.id === 'org-send')).toMatchObject({ state: 'yes', line: 'Switched on.' });
  });

  it('privilegesOfMode agrees with accessMode', () => {
    for (const m of ['admin', 'admin-cant-send', 'my-items'] as const) expect(accessMode(privilegesOfMode(m), true)).toBe(m);
  });
});
