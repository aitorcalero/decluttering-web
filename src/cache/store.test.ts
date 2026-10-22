import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStore, MemoryStore } from './store';

describe('MemoryStore', () => {
  it('gets, sets, deletes, lists and clears', async () => {
    const s = new MemoryStore();
    await s.set('a', { n: 1 });
    await s.set('b', 2);
    expect(await s.get('a')).toEqual({ n: 1 });
    expect((await s.keys()).sort()).toEqual(['a', 'b']);
    await s.delete('a');
    expect(await s.get('a')).toBeUndefined();
    await s.clear();
    expect(await s.keys()).toEqual([]);
  });
  it('stores copies, not references', async () => {
    const s = new MemoryStore();
    const v = { n: 1 };
    await s.set('a', v);
    v.n = 9;
    expect(await s.get('a')).toEqual({ n: 1 });
  });
});

describe('IndexedDbStore', () => {
  it('closes its connection when the database is being deleted, so clearing saved data is not blocked (DC-098)', async () => {
    const dbs: { close: ReturnType<typeof vi.fn>; onversionchange: (() => void) | null; transaction: () => unknown }[] = [];
    const factory = {
      open: vi.fn(() => {
        const db = { close: vi.fn(), onversionchange: null as (() => void) | null,
          transaction: () => ({ objectStore: () => ({ getAllKeys: () => { const r = { result: [], onsuccess: null as null | (() => void), onerror: null }; queueMicrotask(() => r.onsuccess?.()); return r; } }) }) };
        dbs.push(db);
        const req = { result: db, error: null, onsuccess: null as null | (() => void), onerror: null, onupgradeneeded: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      }),
    } as unknown as IDBFactory;
    const s = new IndexedDbStore(factory);
    await s.keys();
    expect(factory.open).toHaveBeenCalledTimes(1);
    dbs[0]!.onversionchange?.();
    expect(dbs[0]!.close).toHaveBeenCalledTimes(1);
    await s.keys(); // reopens
    expect(factory.open).toHaveBeenCalledTimes(2);
  });
});
