// DC-125b (ADR 0013, decisions 4 and 10): sending to owners unlocks only after this admin has sent themselves a test
// that ArcGIS accepted, for this session. Pure and fail-closed: anything but the exact stored "1" for this user and org
// is locked. It lives in sessionStorage (the token's own scope, cleared on sign-out) and never in localStorage, so a new
// session asks for a test again; a different user or org has a different key, so it starts locked.
export const UNLOCK_PREFIX = 'decluttering:test-ok:';

/** The slice of Storage this needs, so tests can pass a fake. */
export interface UnlockStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

function sessionStore(): UnlockStore | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** One key per org and user; null when either is blank (nothing can be unlocked for an unknown person). */
export function unlockKey(username: string, orgId: string): string | null {
  const u = (username ?? '').trim().toLowerCase(), o = (orgId ?? '').trim();
  return u && o ? `${UNLOCK_PREFIX}${encodeURIComponent(o)}:${encodeURIComponent(u)}` : null;
}

export interface Unlock {
  /** Exactly true only after a successful test this session for this user and org. */
  unlocked(): boolean;
  /** Call once ArcGIS has accepted the admin's own test. Never call it on a failure. */
  testSucceeded(): void;
}

export function createUnlock(username: string, orgId: string, store: UnlockStore | null = sessionStore()): Unlock {
  const key = unlockKey(username, orgId);
  let seen = false; // this page's own memory, in case storage is blocked
  return {
    unlocked(): boolean {
      if (!key) return false;
      if (seen) return true;
      try { return store?.getItem(key) === '1'; } catch { return false; }
    },
    testSucceeded(): void {
      if (!key) return;
      seen = true;
      try { store?.setItem(key, '1'); } catch { /* blocked: this page still knows */ }
    },
  };
}

/** Sign-out: forget every unlock in this tab's session, whoever it was for. Best effort. */
export function clearUnlocks(store: UnlockStore | null = sessionStore()): void {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(UNLOCK_PREFIX)) keys.push(k); }
    for (const k of keys) store.removeItem(k);
  } catch { /* nothing more to do */ }
}
