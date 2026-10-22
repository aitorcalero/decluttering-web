// The Suggested preset (DC-034, docs/research/adaptive-presets.md). Ported from prototypes/d-converged/model.test.mjs.
// Ladder rung values are placeholders (TBC) until DC-026 / DC-031 calibrate them.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_NAMES, matchPreset } from './stale';
import { LADDER, suggest, suggestSentence } from './suggest';
import type { Data, Dependency, Service } from './types';

const SCAN = '2026-10-10T09:00:00Z';
const DAY = 86400000;
const isoAgo = (d: number) => new Date(Date.parse(SCAN) - d * DAY).toISOString();

let n = 0;
const hex = () => (++n).toString(16).padStart(32, '0');
const svc = (o: Partial<Service> = {}): Service => ({
  id: hex(), title: `Service ${n}`, owner: 'amy', created: isoAgo(900), modified: isoAgo(800), sizeMB: 50,
  access: 'private', isView: false, sourceId: null, usage: [], dependencies: [], ...o,
});
const dep = (i = 1): Dependency => ({ id: `d${i}`, title: `Map ${i}`, type: 'Web Map', owner: 'amy' });

let on = 0;
const fam = ({ upd = 10, days = [], usedBy = 0, owner }: { upd?: number; days?: number[]; usedBy?: number; owner?: string } = {}): Service => {
  on++;
  return svc({ owner: owner ?? `o${on}`, modified: isoAgo(upd), usage: days.map((d) => [d, 1] as [number, number]), dependencies: Array.from({ length: usedBy }, (_, i) => dep(i)) });
};
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const orgOf = (services: Service[]): Data => {
  const names = [...new Set(services.map((s) => s.owner))];
  return {
    org: { id: 'o', name: 'Org', urlKey: 'org', scannedAt: SCAN },
    owners: names.map((u) => ({ username: u, fullName: u, email: `${u}@example.org`, role: 'org_user', disabled: false, thumbnail: null, lastNotified: null })),
    services,
  };
};
// fresh: recently updated and used on 11 days (more than any rung allows), spread one owner
let fi = 0;
const fresh = (k: number) => Array.from({ length: k }, () => { const b = (fi++ % 8) * 11; return fam({ upd: 10, days: range(b + 1, b + 11), owner: 'busy' }); });
const stale0 = (k: number, owner?: string) => Array.from({ length: k }, () => fam({ upd: 800, owner }));   // flagged from the gentlest rung
const stale1 = (k: number, owner?: string) => Array.from({ length: k }, () => fam({ upd: 800, usedBy: 1, owner }));   // flagged from rung 1 ([365,365,1])
const must = <T>(x: T | null): T => { assert.ok(x); return x as T; };

test('suggest: null for fewer than 20 families, and for data with no usage rows', () => {
  assert.equal(suggest(orgOf([...stale0(5), ...fresh(10)])), null);
  const noUsage = Array.from({ length: 60 }, () => fam({ upd: 800 }));
  assert.equal(suggest(orgOf(noUsage)), null);
});

test('suggest: the ladder runs gentle to strict, and the result is always a rung inside that envelope', () => {
  const last = LADDER.length - 1;
  assert.equal(LADDER.length, 7);
  assert.deepEqual(LADDER[0], [PRESETS.gentle.minDaysSinceUse, PRESETS.gentle.minDaysSinceUpdate, PRESETS.gentle.maxUsedBy]);
  assert.deepEqual(LADDER[last], [PRESETS.strict.minDaysSinceUse, PRESETS.strict.minDaysSinceUpdate, PRESETS.strict.maxUsedBy]);
  for (let i = 1; i <= last; i++) {  // each rung is at least as strict as the one before, in every field
    const a = LADDER[i] as readonly number[], b = LADDER[i - 1] as readonly number[];
    assert.ok((a[0] as number) <= (b[0] as number) && (a[1] as number) <= (b[1] as number) && (a[2] as number) >= (b[2] as number), `rung ${i}`);
  }
  const res = must(suggest(orgOf([...stale0(5), ...fresh(55)])));
  assert.ok(res.rung >= 0 && res.rung <= last);
  assert.deepEqual([res.thresholds.minDaysSinceUse, res.thresholds.minDaysSinceUpdate, res.thresholds.maxUsedBy], LADDER[res.rung]);
});

test('suggest: monotonic. A bigger org never gets a gentler rung; more stale families never a stricter one', () => {
  const rungOf = (r: { rung: number } | null) => (r ? r.rung : Infinity);
  const base = [...stale1(3), ...stale0(3), ...fresh(54)];                                // N = 60
  const bigger = [...stale1(3), ...stale0(3), ...fresh(54 + 40)];                          // N = 100, same stale families
  assert.ok(rungOf(suggest(orgOf(bigger))) >= rungOf(suggest(orgOf(base))));
  const more = [...stale1(3), ...stale0(3), ...stale1(2), ...fresh(52)];                   // N = 60 again, two more stale
  assert.ok(rungOf(suggest(orgOf(more))) <= rungOf(suggest(orgOf(base))));
});

test('suggest: the gentlest rung that reaches half the target; the boundary is exact', () => {
  // N = 60 -> target 9, floor 4.5, so 5 flagged is enough and 4 is not.
  assert.equal(suggest(orgOf([...stale0(4), ...fresh(56)])), null);
  const five = must(suggest(orgOf([...stale0(5), ...fresh(55)])));
  assert.equal(five.rung, 0);
  assert.equal(five.flagged, 5);
  assert.equal(five.target, 9);
  // 4 at the gentlest rung is short of the floor, so it climbs to the first rung that gets there
  const climbs = must(suggest(orgOf([...stale0(4), ...stale1(5), ...fresh(51)])));
  assert.equal(climbs.rung, 1);
  assert.equal(climbs.flagged, 9);
});

test('suggest: the owner cap stops the climb at the last rung under 40 owners', () => {
  // N = 300 -> target 45, floor 22.5. Rung 0 flags 20 families from 20 owners; rung 1 would flag 80 from 80 owners.
  const a = Array.from({ length: 20 }, (_, i) => fam({ upd: 800, owner: `a${i}` }));
  const b = Array.from({ length: 60 }, (_, i) => fam({ upd: 800, usedBy: 1, owner: `b${i}` }));
  const res = must(suggest(orgOf([...a, ...b, ...fresh(220)])));
  assert.equal(res.rung, 0);
  assert.ok(res.owners <= 40);
  assert.equal(res.flagged, 20);
  // with fewer owners the climb carries on: the same 60 families from 10 owners are fine
  const b10 = Array.from({ length: 60 }, (_, i) => fam({ upd: 800, usedBy: 1, owner: `c${i % 10}` }));
  assert.equal(must(suggest(orgOf([...a, ...b10, ...fresh(220)]))).rung, 1);
});

test('suggest: a day every service shares counts as use (DC-057)', () => {
  const shared = range(1, 40);  // every service is used on these 40 days
  const mkOrg = (withShared: boolean, nA: number) => {
    const sw = withShared ? shared : [];
    const A = Array.from({ length: nA }, () => fam({ upd: 400, days: sw }));
    const B = Array.from({ length: 10 }, (_, i) => fam({ upd: 400, days: [...sw, 70 + i, 80 + i] }));
    const F = Array.from({ length: 30 - nA }, () => fam({ upd: 10, days: sw }));
    return orgOf([...A, ...B, ...F]);
  };
  // used in the last 40 days, so nothing is flagged and there is no suggestion
  assert.equal(suggest(mkOrg(true, 3)), null);
  // same families without the shared days: the idle ones count; the ones used 70 to 89 days ago never do
  const open = must(suggest(mkOrg(false, 4)));
  assert.equal(open.flagged, 4);
});

test('suggest: a tidy org gets no suggestion, and the ladder never goes past Strict', () => {
  assert.equal(suggest(orgOf([...stale0(2), ...fresh(98)])), null);
  // plenty that would be flagged only beyond Strict (used in the last 90 days): still null
  const heavy = Array.from({ length: 40 }, (_, i) => fam({ upd: 800, days: range((i % 9) * 10 + 1, (i % 9) * 10 + 9) }));
  assert.equal(suggest(orgOf([...heavy, ...fresh(20)])), null);
});

test('suggest: a rung that equals a preset is reported as that preset', () => {
  // DC-055: the size is part of the match. Rung 0 at 10 MB is not Gentle (20 MB).
  assert.equal(must(suggest(orgOf([...stale0(5), ...fresh(55)]))).preset, 'custom');
  // flagged first at [180,180,1]; 12 is over the target of 9 at 10 MB, so the size steps to 15 MB: exactly Balanced
  const mid = Array.from({ length: 12 }, (_, i) => svc({ owner: `m${i}`, modified: isoAgo(200), lastViewed: isoAgo(200), sizeMB: i < 6 ? 50 : 12, dependencies: [dep(1)] }));
  const res = must(suggest(orgOf([...mid, ...fresh(48)])));
  assert.equal(res.rung, 3);
  assert.equal(res.preset, 'balanced');
  assert.equal(matchPreset(res.thresholds), 'balanced');
  const custom = Array.from({ length: 6 }, () => svc({ owner: 'c', modified: isoAgo(200), lastViewed: isoAgo(100) }));  // [90,180,2] has no preset name
  const c = must(suggest(orgOf([...custom, ...fresh(54)])));
  assert.equal(c.rung, 5);
  assert.equal(c.preset, 'custom');
});

test('suggest: usedBy is ignored while dependencies are unknown, and counts only fall when they arrive', () => {
  const used = Array.from({ length: 6 }, () => fam({ upd: 800, usedBy: 1 }));
  const data = orgOf([...used, ...fresh(54)]);
  const before = must(suggest(data, { depsKnown: false }));
  const after = must(suggest(data, { depsKnown: true }));
  assert.equal(before.rung, 0);
  assert.equal(before.refining, true);
  assert.equal(after.rung, 1);     // [365,365,1] is the first rung that admits one map
  assert.equal(after.refining, false);
  assert.ok(after.rung >= before.rung);
});

// A timing budget. The full suite runs files in parallel next to e2e builds, so in an everyday run only an order-of-magnitude
// regression fails (3 s). The real budget, 500 ms, is checked on a quiet machine: PERF=1 npx vitest run src/domain/suggest.test.ts
const SUGGEST_BUDGET_MS = process.env.PERF === '1' ? 500 : 3000;
test('suggest: 30,000 families within the time budget (500 ms with PERF=1)', { retry: 2 }, () => {
  const services: Service[] = Array.from({ length: 30000 }, (_, i) => ({
    id: `p${i}`, title: `S${i}`, owner: `u${i % 800}`, created: isoAgo(900), modified: isoAgo(i % 5 === 0 ? 800 : 30 + (i % 300)), sizeMB: 50,
    access: 'private', isView: false, sourceId: null, usage: i % 3 === 0 ? [] : [[1 + (i % 80), 1], [2 + (i % 70), 1]], dependencies: [],
  }));
  const data: Data = {
    org: { id: 'o', name: 'Org', urlKey: 'org', scannedAt: SCAN },
    owners: Array.from({ length: 800 }, (_, i) => ({ username: `u${i}`, fullName: `U${i}`, disabled: false, thumbnail: null, lastNotified: null })),
    services,
  };
  const t0 = performance.now();
  const res = suggest(data);
  const ms = performance.now() - t0;
  assert.ok(ms < SUGGEST_BUDGET_MS, `${ms} ms (budget ${SUGGEST_BUDGET_MS} ms)`);
  assert.ok(res === null || res.capped || res.owners <= 40);
});

test('suggestSentence is plain and never says delete', () => {
  const res = must(suggest(orgOf([...stale0(5), ...fresh(55)])));
  const s = suggestSentence(res);
  assert.match(s, /^Suggested for your org: /);
  assert.match(s, /5 services/);
  assert.ok(!/quiet|view|usage call|not used|delet/i.test(s), s);
  assert.match(s, /nobody has used for more than a year/);
  assert.equal(s.split('. ').length, 1);
});

test('PRESETS still iterates only gentle, balanced and strict; Suggested is its own name', () => {
  assert.deepEqual(Object.keys(PRESETS), ['gentle', 'balanced', 'strict']);
  assert.equal(PRESET_NAMES.suggested, 'Suggested');
});
