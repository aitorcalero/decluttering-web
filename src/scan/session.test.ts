// DC-053: Stop semantics (before the core: cancel; after: keep) and resuming from a partial cache.
import { describe, expect, it } from 'vitest';
import { ScanCache, type CacheEntry } from '../cache/scanCache';
import { MemoryStore } from '../cache/store';
import type { Data } from '../domain/types';
import { scanSession, type DataState } from './session';
import type { RequestFn } from './types';

const NOW = Date.parse('2026-10-10T00:00:00Z');
const DAY = 864e5;
const hex = (n: number) => n.toString(16).padStart(32, '0');
const SVC = (name: string) => `https://services1.arcgis.com/X/arcgis/rest/services/${name}/FeatureServer`;
const NS = 60, NM = 30; // each map mentions two services (k and k + 30)
const sIds = Array.from({ length: NS }, (_, k) => hex(0xd000 + k));
const mIds = Array.from({ length: NM }, (_, k) => hex(0xe000 + k));
const services = sIds.map((id, k) => ({
  id, owner: 'alice', title: `S${k}`, size: -1, access: 'private', created: NOW - 900 * DAY, modified: NOW - 800 * DAY,
  url: SVC(`S${k}`), typeKeywords: ['Hosted Service'],
}));
const maps = mIds.map((id, k) => ({ id, title: `M${k}`, type: 'Web Map', owner: 'bob', modified: NOW - (k + 1) * DAY }));

function fake() {
  const calls: string[] = [];
  const request: RequestFn = async (path, params = {}, o = {}) => {
    calls.push(path);
    await new Promise((r) => setTimeout(r, 0));
    if (o.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (path === 'search') {
      const svc = String(params.q).includes('Feature Service');
      return { total: svc ? NS : NM, nextStart: -1, results: svc ? services : maps };
    }
    let m = /^content\/items\/([0-9a-f]{32})$/.exec(path);
    if (m) return { ...services[sIds.indexOf(m[1])], size: 10 * 1048576 };
    m = /^content\/items\/([0-9a-f]{32})\/data$/.exec(path);
    if (m) { const k = mIds.indexOf(m[1]); return JSON.stringify({ layers: [sIds[k], sIds[k + NM]] }); }
    if (path === 'portals/self/usage') return { data: [] };
    if (path === 'portals/self/users') return { total: 2, nextStart: -1, users: [{ username: 'alice' }, { username: 'bob' }] };
    throw new Error(`unexpected ${path}`);
  };
  return { request, calls };
}
const base = { portal: 'https://www.arcgis.com', orgId: 'ORG', now: () => NOW, sleep: async () => {}, random: () => 0, renderMs: 0 };
const sizeCalls = (c: string[]) => c.filter((p) => /^content\/items\/[0-9a-f]{32}$/.test(p));
const dataCalls = (c: string[]) => c.filter((p) => p.endsWith('/data'));
function cacheFor() {
  const cache = new ScanCache(new MemoryStore(), () => new Date(NOW));
  return {
    cache,
    save: (d: Data, f: Parameters<ScanCache['save']>[3], x: Parameters<ScanCache['save']>[4]) => cache.save('ORG', 'admin', d, f, x),
    load: () => cache.load('ORG', 'admin') as Promise<CacheEntry>,
  };
}

describe('scanSession: lazy sizing', () => {
  it('hands the review its data before any size is measured, then fills sizes in', async () => {
    const f = fake();
    const seen: { sizeCallsSoFar: number; state: DataState }[] = [];
    const out = await scanSession(f.request, { ...base, lazySizeThreshold: 5, onData: (_d, state) => seen.push({ sizeCallsSoFar: sizeCalls(f.calls).length, state }) });
    expect(seen[0]).toEqual({ sizeCallsSoFar: 0, state: { depsKnown: false, unmeasured: NS } });
    expect(seen.at(-1)?.state).toEqual({ depsKnown: true, unmeasured: 0 });
    expect(seen.some((s) => s.state.unmeasured > 0 && s.state.unmeasured < NS)).toBe(true); // streamed
    expect(out).toMatchObject({ stopped: false, depsComplete: true, unmeasured: 0 });
    expect(out.sizesMs).not.toBeNull();
  });
});

describe('scanSession: Stop', () => {
  it('before the core finishes, Stop cancels: AbortError, nothing handed out, nothing saved', async () => {
    const f = fake();
    const c = cacheFor();
    const ctl = new AbortController();
    let handed = 0;
    const p = scanSession(f.request, {
      ...base, signal: ctl.signal, save: c.save, onData: () => { handed++; },
      onProgress: (e) => { if (e.phase === 'usage') ctl.abort(); },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(handed).toBe(0);
    expect(await c.load()).toBeUndefined();
  });

  it('after the core, Stop keeps what is known: stopped, sizes and maps partly done, saved as incomplete', async () => {
    const f = fake();
    const c = cacheFor();
    const ctl = new AbortController();
    let last: DataState | null = null;
    const out = await scanSession(f.request, {
      ...base, lazySizeThreshold: 5, signal: ctl.signal, save: c.save,
      onData: (_d, s) => { last = s; ctl.abort(); }, // Stop as soon as the review has data
    });
    expect(out.stopped).toBe(true);
    expect(out.depsComplete).toBe(false);
    expect(out.unmeasured).toBeGreaterThan(0);
    expect(out.data.services.filter((s) => s.sizeMB === null)).toHaveLength(out.unmeasured);
    expect(last).toEqual({ depsKnown: false, unmeasured: out.unmeasured });
    const saved = await c.load();
    expect(saved.incomplete).toEqual({ unmeasured: out.unmeasured, deps: true });
    expect(saved.data.services.filter((s) => s.sizeMB === null)).toHaveLength(out.unmeasured);
  });

  it('on a small org (sizes in the core), Stop after the core leaves every size known and only maps unchecked', async () => {
    const f = fake();
    const ctl = new AbortController();
    const out = await scanSession(f.request, { ...base, signal: ctl.signal, onData: () => ctl.abort() });
    expect(out).toMatchObject({ stopped: true, depsComplete: false, unmeasured: 0 });
  });
});

describe('scanSession: resuming from the cache', () => {
  it('"Finish scanning" measures only the missing sizes and reads only the maps not read yet', async () => {
    const f = fake();
    const c = cacheFor();
    const ctl = new AbortController();
    let n = 0;
    const first = await scanSession(f.request, {
      ...base, lazySizeThreshold: 5, signal: ctl.signal, save: c.save,
      onData: (_d, s) => { if (++n > 1 && s.unmeasured < NS) ctl.abort(); }, // stop after some sizes arrived
    });
    expect(first.stopped).toBe(true);
    const measuredBefore = NS - first.unmeasured;
    expect(measuredBefore).toBeGreaterThan(0);

    const previous = await c.load();
    const readBefore = Object.keys(previous.depsReadAt ?? {}).length;
    expect(readBefore).toBeLessThan(NM);
    f.calls.length = 0;
    const seen: DataState[] = [];
    const second = await scanSession(f.request, { ...base, lazySizeThreshold: 5, previous, save: c.save, onData: (_d, s) => seen.push(s) });
    expect(seen[0]?.unmeasured).toBe(first.unmeasured); // cached sizes show straight away
    expect(sizeCalls(f.calls)).toHaveLength(first.unmeasured);
    expect(dataCalls(f.calls)).toHaveLength(NM - readBefore);
    expect(second).toMatchObject({ stopped: false, depsComplete: true, unmeasured: 0 });
    const done = await c.load();
    expect(done.incomplete).toBeUndefined();
    expect(Object.keys(done.depsReadAt ?? {})).toHaveLength(NM);
    // every service is used by the maps that mention it, as on a single full scan
    expect(second.data.services.every((s) => s.dependencies.length > 0)).toBe(true);
  });

  it('a service modified since the last scan is measured again', async () => {
    const f = fake();
    const c = cacheFor();
    await scanSession(f.request, { ...base, lazySizeThreshold: 5, save: c.save });
    const previous = await c.load();
    previous.data.services[3]!.modified = new Date(NOW - 900 * DAY).toISOString(); // the item has changed since
    f.calls.length = 0;
    await scanSession(f.request, { ...base, lazySizeThreshold: 5, previous });
    expect(sizeCalls(f.calls)).toEqual([`content/items/${sIds[3]}`]);
    expect(dataCalls(f.calls)).toHaveLength(0);
  });
});
