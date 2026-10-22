import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signOut } from './session';

const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); }, has: (k: string) => m.has(k),
  };
};

describe('signOut', () => {
  let session: ReturnType<typeof store>;
  beforeEach(() => {
    session = store();
    session.setItem('decluttering:session', '{"token":"x"}');
    vi.stubGlobal('sessionStorage', session);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('drops the local session and revokes the tokens at ArcGIS Online, without waiting for it', async () => {
    let settle: () => void = () => {};
    const revoke = vi.fn(() => new Promise<never>((_r, reject) => { settle = () => reject(new Error('offline')); }));
    await signOut({ clearData: false }, { signOut: revoke } as never);
    expect(session.has('decluttering:session')).toBe(false);
    expect(revoke).toHaveBeenCalledOnce();
    settle(); // a failed revoke is swallowed: no unhandled rejection
    await Promise.resolve();
  });

  it('works without a manager, and survives one whose revoke throws at once', async () => {
    await signOut({ clearData: false });
    await signOut({ clearData: false }, { signOut: () => { throw new Error('boom'); } } as never);
    await signOut({ clearData: false }, {} as never);
    expect(session.has('decluttering:session')).toBe(false);
  });
});
