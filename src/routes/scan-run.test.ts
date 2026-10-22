import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEPS_RENDER_MS, PACE_MAX_HOLD_MS, PACE_QUIET_MS, paceData, readNudgeLog, runScan, serviceKeeper, summariseNudges, tapRequest, type PaceEnv, type ScanTap } from './scan-run';
import type { ArcGISIdentityManager } from '@esri/arcgis-rest-request';
import type { AccessInfo } from '../auth/session';
import { createFakeLogOrg, createNudgeLog, FAKE_PORTAL, getNudgeSends, getNudgeSummary, seededNudgeLog } from '../log';
import { clearNudgeLogs } from '../log/store';
import { finishClause, sinceNudges } from '../domain/outcomes';
import type { Data, Service } from '../domain/types';
import type { DataState } from '../scan/session';
import type { RequestFn } from '../scan/types';

describe('tapRequest (DC-064)', () => {
  const responses: Record<string, unknown> = {
    search: { results: [{ id: 'a1', title: 'A', owner: 'amy' }, { id: 'b2', title: 'B', owner: 'bob' }] },
    'content/items/a1': { id: 'a1', size: 2 * 1024 * 1024 },
    'content/items/a1/data': '{"operationalLayers":[]}',
    'content/items/a1/relatedItems': { relatedItems: [] },
  };
  const base: RequestFn = async (path) => responses[path];

  it('sees found services, sizes and map reads, and passes every response through unchanged', async () => {
    const seen: ScanTap[] = [];
    const req = tapRequest(base, (e) => seen.push(e));
    expect(await req('search', { q: 'orgid:o AND type:"Feature Service" AND typekeywords:"Hosted Service"' })).toBe(responses.search);
    expect(await req('content/items/a1')).toBe(responses['content/items/a1']);
    expect(await req('content/items/a1/data', {}, { text: true })).toBe(responses['content/items/a1/data']);
    await req('content/items/a1/relatedItems');
    expect(seen).toEqual([
      { kind: 'found', items: [{ id: 'a1', title: 'A', owner: 'amy' }, { id: 'b2', title: 'B', owner: 'bob' }] },
      { kind: 'sized', id: 'a1', sizeMB: 2 },
      { kind: 'read' },
    ]);
  });

  it('DC-071c: a usage window taps days with data requests per service name, and a found service carries what the early map needs', async () => {
    const seen: ScanTap[] = [];
    const usage = { data: [{ name: 'Alpha', num: [[1000, '3'], [2000, 0]] }, { name: '', num: [] }] };
    const req = tapRequest(async (path) => (path === 'search' ? { results: [{ id: 'a1', title: 'A', owner: 'amy', url: 'https://x/rest/services/Alpha/FeatureServer', modified: 5, created: 4, typeKeywords: ['Hosted Service', 'View Service'] }] } : usage), (e) => seen.push(e));
    await req('search', { q: 'type:"Feature Service" AND typekeywords:"Hosted Service"' });
    expect(await req('portals/self/usage', { endTime: 9000 })).toBe(usage);
    expect(seen).toEqual([
      { kind: 'found', items: [{ id: 'a1', title: 'A', owner: 'amy', url: 'https://x/rest/services/Alpha/FeatureServer', modified: 5, created: 4, isView: true }] },
      { kind: 'usage', endTime: 9000, rows: [{ name: 'alpha', num: [[1000, 3], [2000, 0]] }] },
    ]);
  });

  it('DC-071a: an owner content listing taps a size for each hosted feature service in it, and nothing else', async () => {
    const listing = { items: [
      { id: 'c3', type: 'Feature Service', typeKeywords: ['Hosted Service'], size: 3 * 1024 * 1024 },
      { id: 'd4', type: 'Feature Service', typeKeywords: ['Hosted Service', 'View Service'], size: 0 },
      { id: 'e5', type: 'Web Map', typeKeywords: [], size: 2048 },
      { id: 'f6', type: 'Feature Service', typeKeywords: [], size: 4096 }, // not hosted
      { id: 'g7', type: 'Feature Service', typeKeywords: ['Hosted Service'], size: -1 }, // no real size
    ] };
    const seen: ScanTap[] = [];
    const req = tapRequest(async () => listing, (e) => seen.push(e));
    expect(await req('content/users/amy')).toBe(listing);
    await req('content/users/amy/0123456789abcdef0123456789abcdef');
    const one = [{ kind: 'sized', id: 'c3', sizeMB: 3 }, { kind: 'sized', id: 'd4', sizeMB: 0 }];
    expect(seen).toEqual([...one, ...one]);
  });

  it('the maps-and-apps search is not "found services"', async () => {
    const seen: ScanTap[] = [];
    await tapRequest(base, (e) => seen.push(e))('search', { q: 'orgid:o AND (type:"Web Map")' });
    expect(seen).toEqual([]);
  });

  it('errors pass through and nothing is tapped', async () => {
    const seen: ScanTap[] = [];
    const failing: RequestFn = async () => { throw Object.assign(new Error('nope'), { status: 500 }); };
    await expect(tapRequest(failing, (e) => seen.push(e))('content/items/a1')).rejects.toThrow('nope');
    expect(seen).toEqual([]);
  });

  it('a tap that throws never breaks the scan', async () => {
    const req = tapRequest(base, () => { throw new Error('display bug'); });
    expect(await req('content/items/a1')).toBe(responses['content/items/a1']);
  });
});

describe('readNudgeLog (DC-017)', () => {
  const access = { mode: 'admin' as const, writable: true, orgId: 'org1', username: 'me' };
  it('reads an existing log into the store, with reads only', async () => {
    const { readNudgeLog } = await import('./scan-run');
    const { createFakeLogOrg, createNudgeLog, FAKE_PORTAL, getNudgeLog } = await import('../log');
    const fake = createFakeLogOrg({ self: 'me', orgId: 'org1', exists: true });
    const writer = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: 'org1', writableOrgIds: ['org1'] });
    await writer.find();
    await writer.record({ owner: 'amy', sentAt: new Date('2026-10-01T00:00:00Z'), itemIds: [], credits: 0, sender: 'me' });
    fake.calls.length = 0;
    const make = () => createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: 'org1', writableOrgIds: ['org1'] });
    expect(await readNudgeLog(access, make)).toBe(1);
    expect(getNudgeLog('org1')?.get('amy')).toBe('2026-10-01T00:00:00.000Z');
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
  });
  it('does nothing without a log, for members, in read-only orgs, or when the read fails', async () => {
    const { readNudgeLog } = await import('./scan-run');
    const { createFakeLogOrg, createNudgeLog, FAKE_PORTAL } = await import('../log');
    const fake = createFakeLogOrg({ self: 'me', orgId: 'org2' });
    const make = () => createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: 'org2', writableOrgIds: ['org2'] });
    expect(await readNudgeLog({ ...access, orgId: 'org2' }, make)).toBeNull();
    let built = 0;
    const counted = () => { built++; return make(); };
    expect(await readNudgeLog({ ...access, mode: 'my-items' }, counted)).toBeNull();
    expect(await readNudgeLog({ ...access, writable: false }, counted)).toBeNull();
    expect(built).toBe(0);
    expect(await readNudgeLog(access, () => { throw new Error('nope'); })).toBeNull();
  });
});

describe('DC-096: the nudge log read at scan time, and the finish line', () => {
  const ORG = 'devorg0000000001';
  const ID = 'a'.repeat(32), GONE = 'b'.repeat(32);
  const access = { mode: 'admin' as const, writable: true, orgId: ORG, username: 'admin_me' };
  const data: Data = {
    org: { id: ORG, name: 'Org', urlKey: 'org', scannedAt: '2026-10-10T00:00:00.000Z' },
    owners: [{ username: 'amy', fullName: 'Amy', disabled: false, thumbnail: null, lastNotified: null }],
    services: [{ id: ID, title: 'A', owner: 'amy', created: '2024-01-01T00:00:00.000Z', modified: '2024-01-01T00:00:00.000Z', sizeMB: 10, access: 'org', isView: false, sourceId: null, usage: [], lastViewed: null, dependencies: [] }],
  };
  const rows = [
    { owner: 'amy', sent_at: Date.parse('2026-06-01T00:00:00Z'), item_ids: `${ID},${GONE}`, item_count: 2, credits: 50, is_test: 0 },
    { owner: 'admin_me', sent_at: Date.parse('2026-09-01T00:00:00Z'), item_ids: ID, item_count: 1, credits: 1, is_test: 1 },
  ];
  beforeEach(() => clearNudgeLogs());

  it('reads the sends (test rows left out) into memory, GET only, and the summary counts what is gone', async () => {
    const fake = createFakeLogOrg({ self: 'admin_me', orgId: ORG, exists: true, rows });
    const make = () => createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
    expect(await readNudgeLog(access, make)).toBe(2);
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(getNudgeSends(ORG)).toHaveLength(1);
    summariseNudges(ORG, data, false);
    expect(getNudgeSummary(ORG)).toMatchObject({ counts: { gone: 1 }, credits: 25, exact: false });
    expect(finishClause(getNudgeSummary(ORG))).toBe('Since your last nudges: about 25 credits a month saved.');
  });
  it('no log, or a read-only org: nothing read, no summary, no finish clause', async () => {
    const fake = createFakeLogOrg({ self: 'admin_me', orgId: ORG });
    const make = () => createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
    expect(await readNudgeLog(access, make)).toBeNull();
    expect(await readNudgeLog({ ...access, writable: false }, () => { throw new Error('never made'); })).toBeNull();
    summariseNudges(ORG, data, false);
    expect(getNudgeSends(ORG)).toBeUndefined();
    expect(getNudgeSummary(ORG)).toBeNull();
    expect(finishClause(getNudgeSummary(ORG))).toBeNull();
  });
  it('the simulator\'s seeded log gives a mix of past sends, with a test row that is left out', async () => {
    const { createSimulatedOrg, simulatedNudgeRows } = await import('../dev/simulated-org');
    const sim = createSimulatedOrg({ services: 300, speed: 0, now: () => Date.parse('2026-10-10T00:00:00Z') });
    const big: Data = {
      ...data,
      owners: sim.world.owners.map((o) => ({ username: o.username, fullName: o.fullName, disabled: o.disabled, thumbnail: null, lastNotified: null })),
      services: sim.world.services.map((s) => ({ id: s.id, title: s.title, owner: s.owner, created: new Date(s.created).toISOString(), modified: new Date(s.modified).toISOString(), sizeMB: s.size / 1048576, access: s.access, isView: s.typeKeywords.includes('View Service'), sourceId: null, usage: [], lastViewed: s.lastViewed ? new Date(s.lastViewed).toISOString() : null, dependencies: [] })),
    };
    const r = simulatedNudgeRows(big);
    expect(r.some((x) => x.is_test === 1)).toBe(true);
    expect(await readNudgeLog(access, () => seededNudgeLog({ self: 'admin_me', orgId: ORG, rows: r }))).toBeGreaterThan(0);
    const s = sinceNudges(big, getNudgeSends(ORG));
    expect(s?.owners.length).toBeGreaterThan(2);
    expect(s?.counts.gone).toBeGreaterThan(0);
    expect(s?.owners.some((o) => o.owner === 'admin_me')).toBe(false);
  });
});

describe('runScan: resume in the same session (DC-102)', () => {
  const NOW = Date.parse('2026-10-10T00:00:00Z');
  const hex = (n: number) => n.toString(16).padStart(32, '0');
  const NS = 40, NM = 20;
  const sIds = Array.from({ length: NS }, (_, k) => hex(0xa000 + k));
  const mIds = Array.from({ length: NM }, (_, k) => hex(0xb000 + k));
  const services = sIds.map((id, k) => ({ id, owner: 'alice', title: `S${k}`, size: -1, access: 'private', created: NOW - 9e8, modified: NOW - 8e8,
    url: `https://services1.arcgis.com/X/arcgis/rest/services/S${k}/FeatureServer`, typeKeywords: ['Hosted Service'] }));
  const maps = mIds.map((id, k) => ({ id, title: `M${k}`, type: 'Web Map', owner: 'bob', modified: NOW - (k + 1) * 864e5 }));
  const calls: string[] = [];
  const request: RequestFn = async (path, params = {}, o = {}) => {
    calls.push(path);
    await new Promise((r) => setTimeout(r, 0));
    if (o.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (path === 'search') { const svc = String(params.q).includes('Feature Service'); return { total: svc ? NS : NM, nextStart: -1, results: svc ? services : maps }; }
    let m = /^content\/items\/([0-9a-f]{32})$/.exec(path);
    if (m) return { ...services[sIds.indexOf(m[1] as string)], size: 1048576 };
    m = /^content\/items\/([0-9a-f]{32})\/data$/.exec(path);
    if (m) return JSON.stringify({ layers: [sIds[mIds.indexOf(m[1] as string)]] });
    if (path === 'portals/self/usage') return { data: [] };
    if (path === 'portals/self/users') return { total: 2, nextStart: -1, users: [{ username: 'alice' }, { username: 'bob' }] };
    throw new Error(`unexpected ${path}`);
  };
  const access = { mode: 'admin', writable: false, orgId: 'ORG', orgName: 'Org', username: 'admin', usageReadable: true } as unknown as AccessInfo;
  const manager = {} as ArcGISIdentityManager;
  const sizeCalls = () => calls.filter((p) => /^content\/items\/[0-9a-f]{32}$/.test(p));
  const dataCalls = () => calls.filter((p) => p.endsWith('/data'));

  it('the stopped result comes back as an entry; passing it as previous requests only what is missing and ends at 100%', async () => {
    const ctl = new AbortController();
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'decluttering:lazySizeThreshold' ? '5' : null) }); // dev switch: size lazily, as a big org does
    let n = 0;
    const first = await runScan(manager, access, { request, signal: ctl.signal, onTap: (e) => { if (e.kind === 'sized' && ++n === 5) ctl.abort(); } });
    expect(first.stopped).toBe(true);
    expect(first.entry.incomplete).toBeDefined();
    const sizedBefore = NS - first.unmeasured;
    expect(sizedBefore).toBeGreaterThan(0);
    const readBefore = Object.keys(first.entry.depsReadAt ?? {}).length;

    calls.length = 0;
    const stages: number[] = [];
    const second = await runScan(manager, access, { request, previous: first.entry, onStages: (s) => stages.push(s.percent) });
    expect(second.stopped).toBe(false);
    expect(sizeCalls()).toHaveLength(first.unmeasured); // only the sizes the first run didn't reach
    expect(dataCalls()).toHaveLength(NM - readBefore);
    expect(readBefore).toBeLessThan(NM);
    expect(stages.at(-1)).toBe(100);
    expect(second.unmeasured).toBe(0);
    expect(second.depsComplete).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('serviceKeeper (DC-100b)', () => {
  // The scan's copies share a service's usage array (a spread copies the reference), as here.
  const usageOf = new Map<string, Service['usage']>();
  const svc = (id: string, o: Partial<Service> = {}): Service => ({
    id, title: id, owner: 'a', created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', sizeMB: 1, access: 'private', isView: false, sourceId: null,
    usage: usageOf.get(id) ?? (usageOf.set(id, []), usageOf.get(id) as Service['usage']), dependencies: [], ...o,
  });
  const org = { id: 'o', name: 'O', urlKey: 'o', scannedAt: '2026-10-10T00:00:00Z' };
  const data = (services: Service[]): Data => ({ org, owners: [], services });

  it('hands back the previous service object where nothing changed, and a new one where something did', () => {
    const keep = serviceKeeper();
    const dep = { id: 'm1', title: 'M', type: 'Web Map', owner: 'b' };
    const first = keep(data([svc('s1'), svc('s2'), svc('s3')]));
    const next = keep(data([svc('s1'), svc('s2', { sizeMB: 9 }), svc('s3', { dependencies: [dep] })]));
    expect(next.services[0]).toBe(first.services[0]);
    expect(next.services[1]).not.toBe(first.services[1]);
    expect(next.services[1]?.sizeMB).toBe(9);
    expect(next.services[2]?.dependencies).toEqual([dep]);
    // links are compared element by element: a fresh array of the same links is no change
    const again = keep(data([svc('s1'), svc('s2', { sizeMB: 9 }), svc('s3', { dependencies: [dep] })]));
    expect(again.services.every((s, i) => s === next.services[i])).toBe(true);
  });

  it('hands back the previous Data when nothing at all changed, and not when the shell did', () => {
    const keep = serviceKeeper();
    const owners: Data['owners'] = [];
    const a = keep({ ...data([svc('s1')]), owners });
    expect(keep({ ...data([svc('s1')]), owners })).toBe(a);
    expect(keep({ ...data([svc('s1')]), owners: [] })).not.toBe(a);
    const b = keep({ ...data([svc('s1')]), owners, usageComplete: false });
    expect(b).not.toBe(a);
    expect(keep({ ...data([svc('s1'), svc('s2')]), owners, usageComplete: false })).not.toBe(b);
  });
});

describe('paceData (DC-100b)', () => {
  const state = (depsKnown = false): DataState => ({ depsKnown, unmeasured: 0 });
  const make = (cost = 0) => {
    let t = 0, input = -Infinity, hidden = false;
    const timers: { at: number; fn: () => void; id: number }[] = [];
    let next = 1;
    const env: PaceEnv = {
      now: () => t, hidden: () => hidden, lastInput: () => input,
      later: (fn, ms) => { const id = next++; timers.push({ at: t + ms, fn, id }); return id; },
      cancel: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    };
    const got: { at: number; depsKnown: boolean }[] = [];
    let costNow = cost;
    const p = paceData((_d, s) => { got.push({ at: t, depsKnown: s.depsKnown }); t += costNow; }, env);
    // advance the clock, running timers in order
    const run = (ms: number) => {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const n = timers[0];
        if (!n || n.at > end) break;
        timers.shift(); t = Math.max(t, n.at); n.fn();
      }
      t = Math.max(t, end);
    };
    return { p, got, run, now: () => t, setInput: (v: number) => { input = v; }, setHidden: (v: boolean) => { hidden = v; }, setCost: (c: number) => { costNow = c; }, d: {} as Data };
  };

  it('hands the first batch and the last (every map read) over at once, and a quick page gets a batch every DEPS_RENDER_MS', () => {
    const k = make(10);
    k.p.push(k.d, state());
    expect(k.got).toHaveLength(1);
    k.run(DEPS_RENDER_MS); k.p.push(k.d, state()); k.run(0);
    expect(k.got).toHaveLength(2);
    k.p.push(k.d, state(true));
    expect(k.got.at(-1)).toMatchObject({ depsKnown: true });
  });

  it('stretches the gap when a batch was costly, and keeps only the newest batch held', () => {
    const k = make(900);
    k.p.push(k.d, state());                 // first: 900 ms of work
    k.run(1);                               // the cost is read
    k.run(DEPS_RENDER_MS);                  // the session would hand the next one now
    k.p.push(k.d, state()); k.p.push(k.d, state()); k.run(0);
    expect(k.got).toHaveLength(1);          // 900 ms x 5 is not up yet
    k.run(3000);
    expect(k.got).toHaveLength(1);
    k.run(1000);
    expect(k.got).toHaveLength(2);          // one batch, not two
  });

  it('waits while the admin is clicking or typing, but not for ever', () => {
    const k = make(5);
    k.p.push(k.d, state()); k.run(1); k.run(DEPS_RENDER_MS);
    k.setInput(k.now());
    k.p.push(k.d, state());
    k.run(PACE_QUIET_MS - 10);
    expect(k.got).toHaveLength(1);
    k.run(20);
    expect(k.got).toHaveLength(2);
    // keep clicking: still handed over once PACE_MAX_HOLD_MS has gone by
    k.run(DEPS_RENDER_MS);
    k.p.push(k.d, state());
    for (let i = 0; i < PACE_MAX_HOLD_MS / 500 + 4; i++) { k.setInput(k.now()); k.run(500); }
    expect(k.got).toHaveLength(3);
  });

  it('slows down in a hidden tab, and stop() drops what is held', () => {
    const k = make(5);
    k.p.push(k.d, state()); k.run(1); k.run(DEPS_RENDER_MS);
    k.setHidden(true);
    k.p.push(k.d, state()); k.run(3000);
    expect(k.got).toHaveLength(1);
    k.run(3000);
    expect(k.got).toHaveLength(2);
    k.run(DEPS_RENDER_MS * 6);
    k.p.push(k.d, state()); k.p.stop(); k.run(20000);
    expect(k.got).toHaveLength(2);
  });
});
