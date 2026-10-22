import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSimulatedOrg } from './simulated-org';
import { parseSimulate } from './simulate';
import { scanOrg } from '../scan/pipeline';
import { allRows, sweepsOf } from '../domain/stale';
import { sweepSummary } from '../domain/sweep';

const SERVICES = 'orgid:X AND type:"Feature Service" AND typekeywords:"Hosted Service"';
const MAPS = 'orgid:X AND (type:"Web Map" OR type:"Dashboard")';
const fast = { speed: 0, services: 450, now: () => Date.UTC(2026, 9, 10, 9) };

type Page = { total: number; nextStart: number; results: { id: string; typeKeywords: string[] }[] };

async function all(req: ReturnType<typeof createSimulatedOrg>['request'], q: string): Promise<Page['results']> {
  const out: Page['results'] = [];
  for (let start = 1; start > 0;) {
    const r = await req('search', { q, num: 100, start }) as Page;
    out.push(...r.results);
    start = r.nextStart;
  }
  return out;
}

describe('simulated org', () => {
  it('pages the search 100 at a time, ends with nextStart -1 and returns every service once', async () => {
    const { request, world } = createSimulatedOrg(fast);
    const first = await request('search', { q: SERVICES, num: 100, start: 1 }) as Page;
    expect(first.total).toBe(450);
    expect(first.results).toHaveLength(100);
    expect(first.nextStart).toBe(101);
    const rows = await all(request, SERVICES);
    expect(rows).toHaveLength(450);
    expect(new Set(rows.map((r) => r.id)).size).toBe(450);
    const last = await request('search', { q: SERVICES, num: 100, start: 401 }) as Page;
    expect(last.results).toHaveLength(50);
    expect(last.nextStart).toBe(-1);
    expect(world.services.filter((s) => s.typeKeywords.includes('View Service')).length).toBe(90); // 20%
  });

  it('is deterministic for a seed and differs for another', async () => {
    const ids = async (seed: number) => (await all(createSimulatedOrg({ ...fast, seed }).request, SERVICES)).map((r) => r.id);
    expect(await ids(5)).toEqual(await ids(5));
    expect(await ids(5)).not.toEqual(await ids(6));
  });

  it('answers items with sizes (median under 1 MB), related items for views, users and usage', async () => {
    const { request, world } = createSimulatedOrg({ ...fast, services: 1000 });
    const sizes = world.services.filter((s) => !s.typeKeywords.includes('View Service')).map((s) => s.size / 1048576).sort((a, b) => a - b);
    expect(sizes[sizes.length >> 1]).toBeLessThan(1);
    expect(sizes.at(-1)).toBeGreaterThan(50);
    const view = world.services.find((s) => s.typeKeywords.includes('View Service'))!;
    const rel = await request(`content/items/${view.id}/relatedItems`, { relationshipType: 'Service2Service' }) as { relatedItems: { id: string }[] };
    expect(rel.relatedItems).toHaveLength(1);
    const item = await request(`content/items/${world.services[0]!.id}`) as { size: number };
    expect(item.size).toBe(world.services[0]!.size);
    const users = await request('portals/self/users', { num: 100, start: 1 }) as { total: number; users: unknown[] };
    expect(users.total).toBe(world.owners.length);
    const now = Date.UTC(2026, 9, 10, 9);
    const usage = await request('portals/self/usage', { startTime: now - 150 * 864e5, endTime: now, groupby: 'name' }, { method: 'POST' }) as { data: { name: string; num: [number, string][] }[] };
    expect(usage.data.length).toBeGreaterThan(100);
    expect(usage.data[0]!.num[0]![0]).toBeGreaterThanOrEqual(now - 150 * 864e5);
  });

  it('DC-083: search rows carry lastViewed and numViews; lastViewed is never older than the last request', async () => {
    const { world, request } = createSimulatedOrg({ ...fast, services: 1000 });
    const svcs = world.services;
    expect(svcs.every((s) => s.lastViewed === null || typeof s.lastViewed === 'number')).toBe(true);
    const blank = svcs.filter((s) => s.lastViewed === null).length;
    expect(blank).toBeGreaterThan(20);
    expect(blank).toBeLessThan(svcs.length / 2);
    const recent = svcs.filter((s) => s.lastViewed && s.lastViewed > fast.now() - 4 * 864e5).length;
    expect(recent).toBeGreaterThan(svcs.length / 10);
    expect(svcs.some((s) => (s.numViews ?? 0) > 10000)).toBe(true);
    const page = await request('search', { q: 'orgid:x AND type:"Feature Service" AND typekeywords:"Hosted Service"', num: 100, start: 1 }) as { results: Record<string, unknown>[] };
    expect(page.results.every((r) => 'lastViewed' in r && typeof r.numViews === 'number')).toBe(true);
    // never older than the start of the newest day with requests
    const usage = await request('portals/self/usage', { startTime: fast.now() - 150 * 864e5, endTime: fast.now(), groupby: 'name' }, { method: 'POST' }) as { data: { name: string; num: [number, string][] }[] };
    const byName = new Map(usage.data.map((d) => [d.name.toLowerCase(), d.num.filter(([, c]) => Number(c) > 0).map(([t]) => t)]));
    let checked = 0;
    for (const s of svcs) {
      const name = /\/services\/([^/]+)\//.exec(s.url ?? '')?.[1]?.toLowerCase();
      const ts = name ? byName.get(name) ?? [] : [];
      if (!ts.length) continue;
      checked++;
      expect(s.lastViewed, s.title).not.toBeNull();
      expect(s.lastViewed as number).toBeGreaterThanOrEqual(Math.max(...ts));
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('answers a few unreadable maps with HTTP 200 and error.code 500, and the rest with data', async () => {
    const { request, world } = createSimulatedOrg({ ...fast, services: 700, unreadableMaps: 2 });
    expect(world.unreadable.size).toBe(2);
    const bad = [...world.unreadable][0]!;
    expect(await request(`content/items/${bad}/data`)).toEqual({ error: { code: 500, message: expect.any(String), details: [] } });
    await expect(request(`content/items/${bad}/data`, {}, { text: true })).rejects.toMatchObject({ code: 500 });
    const good = world.maps.find((m) => !world.unreadable.has(m.id))!;
    const text = await request(`content/items/${good.id}/data`, {}, { text: true });
    expect(typeof text).toBe('string');
    expect(JSON.parse(text as string)).toHaveProperty('operationalLayers');
    expect((await all(request, MAPS)).length).toBe(world.maps.length);
  });

  it('can answer 429 with a retryAfter, at the configured rate', async () => {
    const { request, stats } = createSimulatedOrg({ ...fast, rate429: 1, retryAfter: 3, speed: 0 });
    await expect(request('search', { q: SERVICES })).rejects.toMatchObject({ status: 429, retryAfter: 0 });
    expect(stats.rate429).toBe(1);
    const none = createSimulatedOrg({ ...fast, rate429: 0 });
    await expect(none.request('search', { q: SERVICES })).resolves.toBeTruthy();
  });

  it('honours AbortSignal: before the call and while waiting', async () => {
    const { request } = createSimulatedOrg({ ...fast, speed: 1 });
    const pre = new AbortController();
    pre.abort();
    await expect(request('search', { q: SERVICES }, { signal: pre.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const live = new AbortController();
    const started = Date.now();
    const p = request('search', { q: SERVICES }, { signal: live.signal });
    setTimeout(() => live.abort(), 20);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(300); // not the full 400 ms
  });

  it('slows down with load and speed scales latency', async () => {
    const slow = createSimulatedOrg({ ...fast, speed: 1, latency: { search: 100, item: 100, data: 100, related: 100, users: 100, usageMin: 100, usageMax: 100 } });
    const t = Date.now();
    await Promise.all(Array.from({ length: 12 }, () => slow.request('portals/self/users', { num: 10 })));
    expect(slow.stats.maxInFlight).toBe(12);
    expect(Date.now() - t).toBeGreaterThanOrEqual(60);
  });

  it('runs the real scan end to end (lazy sizes, views, usage, owners, maps)', async () => {
    const org = createSimulatedOrg({ ...fast, services: 300, maps: 120, unreadableMaps: 2 });
    const res = await scanOrg(org.request, { portal: 'https://sim.example', orgId: 'X', lazySizeThreshold: 150, sleep: async () => {}, now: () => Date.UTC(2026, 9, 10, 9) });
    expect(res.data.services).toHaveLength(300);
    expect(res.data.owners.length).toBeGreaterThan(5);
    expect(res.data.services.every((s) => s.sizeMB !== null)).toBe(true);
    expect(res.data.services.filter((s) => s.isView).every((s) => s.sourceId)).toBe(true);
    expect(res.data.services.some((s) => s.usage.length > 0)).toBe(true);
    expect(res.data.services.some((s) => s.dependencies.length > 0)).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/2 maps or apps could not be read/);
  });

  it('DC-086: has a few sweep days, one recent, and the recent one moved lastViewed into one hour', async () => {
    const org = createSimulatedOrg({ ...fast, services: 600, maps: 50 });
    const res = await scanOrg(org.request, { portal: 'https://sim.example', orgId: 'X', sleep: async () => {}, now: fast.now });
    const sw = sweepsOf(res.data);
    expect(sw.days.has(4)).toBe(true);
    expect(sw.days.size).toBeGreaterThanOrEqual(3);
    expect(sw.hours.size).toBe(1);
    const s = sweepSummary(sw, fast.now())!;
    expect(s.latestDaysAgo).toBe(4);
    expect(s.latest).toBe('6 Oct 2026');
    // setting the light touches aside finds more layers unused for 6 months than counting them does
    const t = { minDaysSinceUse: 180, minDaysSinceUpdate: 0, maxUsedBy: 99, minSizeMB: 0 };
    const aside = allRows(res.data, t).filter((r) => r.stale).length;
    const counted = allRows(res.data, t, { countSweeps: true }).filter((r) => r.stale).length;
    expect(aside).toBeGreaterThan(counted * 1.5);
  });
});

describe('dev route', () => {
  it('parses #/simulate and ignores other hashes', () => {
    expect(parseSimulate('#/simulate?n=7000&speed=0.2&r429=0.05')?.config).toEqual({ services: 7000, speed: 0.2, rate429: 0.05 });
    expect(parseSimulate('#/simulate')?.config).toEqual({});
    expect(parseSimulate('#/demo')).toBeNull();
    expect(parseSimulate('#/simulated')).toBeNull();
  });

  it('parses solo=1 (DC-103) and a solo org has one member who owns everything', () => {
    expect(parseSimulate('#/simulate?n=200&solo=1')?.config).toEqual({ services: 200, solo: true });
    expect(parseSimulate('#/simulate?n=200&solo=0')?.config).toEqual({ services: 200 });
    const { world } = createSimulatedOrg({ ...fast, services: 200, solo: true });
    expect(world.owners.map((o) => o.username)).toEqual(['sim_admin']);
    expect(world.owners[0]?.disabled).toBe(false);
    expect(new Set([...world.services, ...world.maps, ...world.extras].map((x) => x.owner))).toEqual(new Set(['sim_admin']));
  });

  it('is only reachable behind import.meta.env.DEV, as a dynamic import, so production builds drop it', () => {
    const root = readFileSync(new URL('../app-root.ts', import.meta.url), 'utf8');
    const hits = root.match(/dev\/simulate/g) ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(root).not.toMatch(/^\s*import[^\n]*['"]\.\/dev\//m); // never a static import
    expect(root).toMatch(/import\.meta\.env\.DEV && await this\.maybeSimulate\(\)/);
    expect(root).toMatch(/maybeSimulate[\s\S]{0,200}if \(!import\.meta\.env\.DEV\) return false;\s*const sim = await import\('\.\/dev\/simulate'\)/);
    // And nothing else in the app imports from src/dev.
    const others = ['./routes/scan-run.ts', './main.ts'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
    for (const o of others) expect(o).not.toMatch(/from ['"][./]+\/dev\//);
  });
});

describe('content listings (DC-071a)', () => {
  type Listing = { username: string; total: number; start: number; num: number; nextStart: number; items: { id: string; size: number; owner: string; type: string; typeKeywords: string[] }[]; folders?: { id: string; title: string }[] };
  const listAll = async (req: ReturnType<typeof createSimulatedOrg>['request'], path: string) => {
    const out: Listing['items'] = [];
    let first: Listing | null = null;
    for (let start = 1; start > 0;) {
      const r = await req(path, { num: 100, start }) as Listing;
      first ??= r;
      out.push(...r.items);
      start = r.nextStart;
    }
    return { first: first as Listing, items: out };
  };

  it('lists an owner root and folders, covering every item of the owner exactly once, with sizes equal to content/items', async () => {
    const sim = createSimulatedOrg(fast);
    const { world, request } = sim;
    const owner = world.owners[0]!.username;
    const root = await listAll(request, `content/users/${owner}`);
    expect(root.first.username).toBe(owner);
    const ids = new Set(root.items.map((i) => i.id));
    for (const f of root.first.folders ?? []) for (const i of (await listAll(request, `content/users/${owner}/${f.id}`)).items) ids.add(i.id);
    const mine = [...world.services, ...world.maps, ...world.extras].filter((i) => i.owner === owner);
    expect(ids.size).toBe(mine.length);
    for (const i of mine) expect(ids.has(i.id)).toBe(true);
    for (const i of root.items.slice(0, 20)) {
      const direct = await request(`content/items/${i.id}`) as { size: number };
      expect(i.size).toBe(direct.size);
    }
  });

  it('pages 100 at a time with start/num and ends with nextStart -1', async () => {
    const { request, world } = createSimulatedOrg({ ...fast, services: 1000, owners: 3 });
    const big = world.owners.map((o) => o.username).find((u) => [...world.services, ...world.maps, ...world.extras].filter((i) => i.owner === u).length > 150) as string;
    const folders = ((await request(`content/users/${big}`, { num: 100, start: 1 })) as Listing).folders ?? [];
    const sizes: number[] = [];
    for (const path of [`content/users/${big}`, ...folders.map((f) => `content/users/${big}/${f.id}`)]) {
      const p1 = await request(path, { num: 100, start: 1 }) as Listing;
      expect(p1.items.length).toBeLessThanOrEqual(100);
      if (p1.total > 100) {
        expect(p1.nextStart).toBe(101);
        const p2 = await request(path, { num: 100, start: 101 }) as Listing;
        expect(p2.start).toBe(101);
        expect(p2.items[0]!.id).not.toBe(p1.items[0]!.id);
        sizes.push(p1.total);
      } else expect(p1.nextStart).toBe(-1);
    }
    expect(sizes.length).toBeGreaterThan(0);
  });

  it('gives most owners 0 to 3 folders, a few many, includes non-service items and carries ownerFolder on search rows', async () => {
    const { world, request } = createSimulatedOrg({ ...fast, services: 3500 });
    const counts = world.owners.map((o) => world.folders.get(o.username)!.length);
    expect(counts.filter((n) => n <= 3).length / counts.length).toBeGreaterThan(0.7);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(6);
    expect(world.extras.length).toBeGreaterThan(0);
    expect(world.extras.every((e) => !e.typeKeywords.includes('Hosted Service'))).toBe(true);
    const s = world.services.find((x) => world.folderOf.has(x.id)) as (typeof world.services)[number];
    const row = (await request('search', { q: SERVICES, num: 100, start: 1 }) as { results: { id: string; ownerFolder: string | null }[] }).results.find((r) => r.id === s.id);
    if (row) expect(row.ownerFolder).toBe(world.folderOf.get(s.id));
    expect(world.services.some((x) => !world.folderOf.has(x.id))).toBe(true);
  });

  it('is deterministic by seed, answers unknown owners and folders with an error body, and does not shift the services', async () => {
    const a = createSimulatedOrg(fast), b = createSimulatedOrg(fast);
    expect([...a.world.folderOf]).toEqual([...b.world.folderOf]);
    expect(await a.request('content/users/nobody_sim')).toMatchObject({ error: { code: 400 } });
    expect(await a.request(`content/users/${a.world.owners[0]!.username}/${'0'.repeat(32)}`)).toMatchObject({ error: { code: 400 } });
    expect(a.stats.calls.listing).toBe(2);
  });
});
