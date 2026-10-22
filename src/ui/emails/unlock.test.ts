import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearUnlocks, createUnlock, UNLOCK_PREFIX, unlockKey, type UnlockStore } from './unlock';
import { signOut } from '../../auth/session';
import { gateNotifier, gateNudgeLog, OwnerSendsOff } from './gate';
import { createDemoNotifier, createDemoNudgeLog } from './demo-notifier';

const memStore = (): UnlockStore & { keys: () => string[] } => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, keys: () => [...m.keys()],
  };
};

describe('the test-first unlock (DC-125b, ADR 0013)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is locked by default, and stays locked for a blank user or org', () => {
    const s = memStore();
    expect(createUnlock('sam', 'org1', s).unlocked()).toBe(false);
    expect(createUnlock('', 'org1', s).unlocked()).toBe(false);
    expect(createUnlock('sam', '  ', s).unlocked()).toBe(false);
    expect(unlockKey('', 'o')).toBeNull();
  });

  it('unlocks only after a successful test, and a failed test (nothing recorded) stays locked', () => {
    const s = memStore();
    const u = createUnlock('sam', 'org1', s);
    expect(u.unlocked()).toBe(false); // the test threw: testSucceeded() is never called
    expect(s.keys()).toEqual([]);
    u.testSucceeded();
    expect(u.unlocked()).toBe(true);
  });

  it('is remembered for this session (a reload builds a new object on the same store) ...', () => {
    const s = memStore();
    createUnlock('sam', 'org1', s).testSucceeded();
    expect(createUnlock('sam', 'org1', s).unlocked()).toBe(true);
  });

  it('... but a different user or a different org starts locked', () => {
    const s = memStore();
    createUnlock('sam', 'org1', s).testSucceeded();
    expect(createUnlock('alex', 'org1', s).unlocked()).toBe(false);
    expect(createUnlock('sam', 'org2', s).unlocked()).toBe(false);
  });

  it('only the exact stored value counts (fail closed)', () => {
    const s = memStore();
    s.setItem(unlockKey('sam', 'org1')!, 'true');
    expect(createUnlock('sam', 'org1', s).unlocked()).toBe(false);
    s.setItem(unlockKey('sam', 'org1')!, '1');
    expect(createUnlock('sam', 'org1', s).unlocked()).toBe(true);
  });

  it('a sign-out clears it, whoever it was for', () => {
    const s = memStore();
    s.setItem('decluttering:session', 'x');
    createUnlock('sam', 'org1', s).testSucceeded();
    createUnlock('alex', 'org2', s).testSucceeded();
    clearUnlocks(s);
    expect(createUnlock('sam', 'org1', s).unlocked()).toBe(false);
    expect(createUnlock('alex', 'org2', s).unlocked()).toBe(false);
    expect(s.keys()).toEqual(['decluttering:session']); // only its own keys
  });

  it('a storage that throws never unlocks by accident, and never breaks the page', () => {
    const bad: UnlockStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); }, key: () => null, length: 0 };
    const u = createUnlock('sam', 'org1', bad);
    expect(u.unlocked()).toBe(false);
    expect(() => clearUnlocks(bad)).not.toThrow();
    expect(() => u.testSucceeded()).not.toThrow();
    expect(u.unlocked()).toBe(true); // the test did succeed in this page's life
    expect(createUnlock('sam', 'org1', bad).unlocked()).toBe(false);
  });

  it('uses sessionStorage by default and never touches localStorage', () => {
    const session = memStore(), local = memStore();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', local);
    createUnlock('sam', 'org1').testSucceeded();
    expect(session.keys().length).toBe(1);
    expect(session.keys()[0]!.startsWith(UNLOCK_PREFIX)).toBe(true);
    expect(local.keys()).toEqual([]);
    clearUnlocks();
    expect(session.keys()).toEqual([]);
  });

  it('the host closures (gateNotifier and gateNudgeLog) refuse owner sends before the unlock and allow them after', async () => {
    const s = memStore();
    const u = createUnlock('me_admin', 'org1', s);
    const unlocked = (): boolean => u.unlocked();
    const d = createDemoNotifier({ self: 'me_admin' });
    const n = gateNotifier(d.notifier, unlocked);
    const log = gateNudgeLog(createDemoNudgeLog({ self: 'me_admin', orgId: 'org1' }).log, unlocked);
    await n.createGroup();
    await expect(n.sendToOwner('owner_1', 's', '<p>h</p>')).rejects.toBeInstanceOf(OwnerSendsOff);
    await expect(log.create()).rejects.toBeInstanceOf(OwnerSendsOff);
    await n.sendTest('s', '<p>h</p>'); // the test to the admin works while locked
    u.testSucceeded();
    await expect(n.sendToOwner('owner_1', 's', '<p>h</p>')).resolves.toBeDefined();
    await expect(log.create()).resolves.toBeDefined();
  });

  it('signOut() clears it, with or without clearing saved data', async () => {
    for (const clearData of [false, true]) {
      const session = memStore();
      vi.stubGlobal('sessionStorage', session);
      vi.stubGlobal('localStorage', memStore());
      vi.stubGlobal('indexedDB', {});
      createUnlock('sam', 'org1').testSucceeded();
      expect(createUnlock('sam', 'org1').unlocked()).toBe(true);
      await signOut({ clearData });
      expect(createUnlock('sam', 'org1').unlocked()).toBe(false);
    }
  });
});
