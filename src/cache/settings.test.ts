import { describe, expect, it } from 'vitest';
import { PREFIX, Settings, clearSavedData, countSweeps, countSweepsFor, onCountSweepsChange, setCountSweeps, type StorageLike } from './settings';
import { MemoryStore } from './store';

function fakeStorage(): StorageLike & { dump(): string[] } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => [...m.keys()],
  };
}

describe('Settings', () => {
  it('round-trips typed values under the prefix', () => {
    const ls = fakeStorage();
    const s = new Settings(ls);
    s.set('splashDismissed', true);
    expect(s.get('splashDismissed')).toBe(true);
    expect(ls.dump()).toEqual([PREFIX + 'splashDismissed']);
    expect(s.get('templateEdits')).toBeUndefined();
  });
});

describe('clearSavedData', () => {
  it('clears prefixed keys and the scan cache, leaving other keys', async () => {
    const ls = fakeStorage();
    ls.setItem('other', 'x');
    new Settings(ls).set('splashDismissed', true);
    new Settings(ls).set('templateEdits', { a: 'b' });
    const cache = new MemoryStore();
    await cache.set('scan:o1:admin', {});
    await clearSavedData(ls, cache);
    expect(ls.dump()).toEqual(['other']);
    expect(await cache.keys()).toEqual([]);
  });
});

describe('DC-086 count sweeps setting', () => {
  it('is off by default, per org, and tells listeners', () => {
    const ls = fakeStorage();
    expect(countSweepsFor('o1', ls)).toBe(false);
    let told = 0;
    const off = onCountSweepsChange(() => { told++; });
    setCountSweeps('o1', true, ls);
    expect(countSweepsFor('o1', ls)).toBe(true);
    expect(countSweepsFor('o2', ls)).toBe(false);
    expect(countSweeps('o1', ls)).toBe(true);
    setCountSweeps('o1', false, ls);
    expect(countSweepsFor('o1', ls)).toBe(false);
    expect(ls.dump()).toEqual([PREFIX + 'countSweeps']);
    expect(told).toBe(2);
    off();
    setCountSweeps('o1', false, ls);
    expect(told).toBe(2);
  });

  it('survives blocked storage: reads off, and a click still holds for the page', () => {
    const blocked: StorageLike = {
      getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); },
      removeItem: () => undefined, key: () => null, length: 0,
    };
    expect(countSweepsFor('o9', blocked)).toBe(false);
    expect(() => setCountSweeps('o9', true, blocked)).not.toThrow();
    expect(countSweeps('o9', blocked)).toBe(true);
    expect(countSweepsFor(undefined)).toBe(false);
  });
});
