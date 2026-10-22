import { test } from 'vitest';
import assert from 'node:assert/strict';
import { priorityOf, IMPACT_FLOOR_CREDITS, PRIORITY_LABELS, sortRows } from './priority';
import { creditsPerMonth, evaluate } from './stale';
import type { Data, Row, Service, Thresholds } from './types';

// Case table from prototypes/d-converged/model.test.mjs (ADR 0010). DC-083: the prototype is frozen at the days-used
// rule, so the last column is now days since last use (null: no use in the year read) and the two no longer match.
// Row = [sizeMB, access, usedBy, lastUsedDaysAgo]. Others = sizeMB of filler stale rows (private, usedBy 0, never used).
type Case = [string, [number, string, number, number | null], number[], 'start' | 'look' | 'low'];
export const PRIORITY_CASES: Case[] = [
  // id, row [sizeMB, access, usedBy, lastUsedDaysAgo], others [sizeMB...], expected
  ['P01 big private unused',               [120, 'private', 0, null], [],                          'start'],
  ['P02 big private, used by a map',       [120, 'private', 1, null], [],                          'look'],
  ['P03 big org-wide, used 200 days ago',  [120, 'org',     0, 200], [],                          'look'],
  ['P04 big org-wide, never used',         [120, 'org',     0, null], [],                          'start'],
  ['P05 big public, never used',           [120, 'public',  0, null], [],                          'start'],
  ['P06 big public, used by a map',        [120, 'public',  1, null], [],                          'low'],
  ['P07 big org-wide, used by app, never', [120, 'org',     2, null], [],                          'low'],
  ['P08 big shared to groups only',        [120, 'shared',  0, 200], [],                          'start'],
  ['P09 shared to groups, used by a map',  [120, 'shared',  1, null], [],                          'look'],
  ['P10 small, bottom of set',             [0.5, 'private', 0, null], [3, 4, 5, 6, 7, 8],          'low'],
  ['P11 small but in top third of set',    [8,   'private', 0, null], [1, 2, 3, 4, 5],             'start'],
  ['P12 exactly 10 MB beats a giant set',  [10,  'private', 0, null], [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 'start'],
  ['P13 just under 10 MB, giants above (mid band)',   [9.9, 'private', 0, null], [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 'look'],
  ['P14 tie at the cutoff counts as high', [5,   'private', 0, null], [5, 5, 1, 1, 1],             'start'],
  ['P15 lone small row is its own top',    [1,   'private', 0, null], [],                          'start'],
  ['P16 zero storage (view-only) is low',  [0,   'private', 0, null], [],                          'low'],
  ['P17 unknown access treated as wide',   [120, 'weird',   0, 200], [],                          'look'],
  // ADR 0010 amendment (DC-043): Low impact is genuinely small; the middle band is Worth a look.
  ['P18 mid-size is not low',              [5,   'private', 0, null], [100, 100, 100],             'look'],
  ['P19 tiny, bottom third, is low',       [0.5, 'private', 0, null], [100, 100, 100],             'low'],
  ['P20 tiny but mid-ranked is not low',   [0.5, 'private', 0, null], [0.1, 0.1, 0.1, 100, 100, 100], 'look'],
  ['P21 mid-size, wide and used is low',   [5,   'org',     1, null], [100, 100, 100],             'low'],
  ['P22 just under 1 MB, bottom, is low',  [0.99,'private', 0, null], [100, 100, 100],             'low'],
  ['P23 exactly 1 MB is not low',          [1,   'private', 0, null], [100, 100, 100],             'look'],
];

const prow = ([sizeMB, access, usedBy, lastUsedDaysAgo]: [number, string, number, number | null], o: Partial<Row> = {}): Row =>
  ({ sizeMB, credits: creditsPerMonth(sizeMB), usedBy, lastUsedDaysAgo, useKnown: true, noUseRecorded: false, source: { access }, ...o }) as unknown as Row;

for (const [name, row, others, want] of PRIORITY_CASES) {
  test(`priority ${name} -> ${want}`, () => {
    const r = prow(row);
    const stale = [r, ...others.map((mb) => prow([mb, 'private', 0, null]))];
    const got = priorityOf(r, stale);
    assert.equal(got.priority, want);
    assert.ok(got.reason.startsWith(`${PRIORITY_LABELS[want]}:`), got.reason);
    assert.ok(!/delet/i.test(got.reason), 'never says delete');
  });
}

test('priority constants: floor is 10 MB of credits, labels are plain', () => {
  assert.equal(IMPACT_FLOOR_CREDITS, 2.4);
  assert.deepEqual(PRIORITY_LABELS, { start: 'Quick win', look: 'Worth a look', low: 'Low impact' });
});

test('priority reason lines explain the result in one line', () => {
  const r = prow([120, 'private', 0, null]);
  assert.equal(priorityOf(r, [r]).reason, 'Quick win: 120 MB, only its owner can see it, and no data requests in the last year.');
  const none = prow([120, 'org', 0, null], { noUseRecorded: true });
  assert.equal(priorityOf(none, [none]).reason, 'Quick win: 120 MB, shared with the whole org, and no use recorded since at least November 2022.');
  const months = prow([120, 'org', 0, 240]);
  assert.equal(priorityOf(months, [months]).reason, 'Worth a look: 120 MB, shared with the whole org, and last used 8 months ago.');
  const year = prow([120, 'org', 0, 365]);
  assert.equal(priorityOf(year, [year]).priority, 'start'); // wide, but unused for a year: a Quick win
  const unknown = prow([120, 'private', 0, null], { useKnown: false });
  assert.equal(priorityOf(unknown, [unknown]).reason, 'Worth a look: 120 MB, only its owner can see it, and its last use is unknown.');
  const low = prow([0.5, 'private', 0, null]);
  const big = prow([100, 'private', 0, null]);
  const lr = priorityOf(low, [low, big, big, big]).reason;
  assert.match(lr, /^Low impact: /);
  assert.match(lr, /0\.5 MB/);
  const used = prow([120, 'public', 3, null]);
  assert.match(priorityOf(used, [used]).reason, /^Low impact: .*3 maps or apps/);
});

const mkRow = (o: { credits?: number; daysSinceUpdate?: number } = {}): Row =>
  ({ credits: o.credits ?? 5, sizeMB: 1, daysSinceUpdate: o.daysSinceUpdate ?? 0, source: { title: 'T' } }) as unknown as Row;

test('sortRows: priority, then credits; the input is not mutated', () => {
  const a = { ...mkRow({ credits: 3 }), priority: 'look' } as Row;
  const b = { ...mkRow({ credits: 9 }), priority: 'low' } as Row;
  const c = { ...mkRow({ credits: 5 }), priority: 'start' } as Row;
  const d = { ...mkRow({ credits: 8 }), priority: 'start' } as Row;
  const input = [a, b, c, d];
  assert.deepEqual(sortRows(input, 'priority'), [d, c, a, b]);
  assert.deepEqual(sortRows(input, 'credits'), [b, d, c, a]);
  assert.deepEqual(input, [a, b, c, d]);
});

test('sortRows: last updated puts the oldest first', () => {
  const x = mkRow({ daysSinceUpdate: 400 });
  const y = mkRow({ daysSinceUpdate: 900 });
  assert.deepEqual(sortRows([x, y], 'updated'), [y, x]);
});

test('sortRows: least viewed first (FB-61); no view count goes last, then credits break ties', () => {
  const a = { ...mkRow({ credits: 1 }), numViews: 10 } as Row;
  const b = { ...mkRow({ credits: 9 }), numViews: null } as Row;
  const c = { ...mkRow({ credits: 2 }), numViews: 585557 } as Row;
  const d = { ...mkRow({ credits: 3 }), numViews: 10 } as Row;
  assert.deepEqual(sortRows([a, b, c, d], 'views'), [d, a, c, b]);
});

const SCAN = '2026-10-10T09:00:00Z';
const ago = (d: number) => new Date(Date.parse(SCAN) - d * 86400000).toISOString();
const svc = (title: string, sizeMB: number, access: string, o: Partial<Service> = {}): Service => ({
  id: title, title, owner: 'amy', created: ago(900), modified: ago(800), sizeMB, access, isView: false, sourceId: null, usage: [], dependencies: [], ...o,
});
const mk = (services: Service[]): Data => ({
  org: { id: 'o', name: 'Org', urlKey: 'org', scannedAt: SCAN },
  owners: [
    { username: 'amy', fullName: 'Amy A', disabled: false, thumbnail: null, lastNotified: null },
    { username: 'bob', fullName: 'Bob B', disabled: false, thumbnail: null, lastNotified: null },
  ], services,
});
const T: Thresholds = { minDaysSinceUse: 180, minDaysSinceUpdate: 365, maxUsedBy: 1 };
const dep = { id: 'd1', title: 'Map 1', type: 'Web Map', owner: 'amy' };

test('evaluate() rows carry priority and priorityReason; default order is priority then credits', () => {
  const data = mk([
    svc('Big public used', 500, 'public', { dependencies: [dep] }),   // low
    svc('Medium private', 100, 'private'),                           // start
    svc('Big org unused', 300, 'org'),                               // start (never used)
    svc('Big org some use', 400, 'org', { usage: [[200, 1]] }),      // look (used 200 days ago: under a year)
    svc('Tiny', 0.5, 'private'),                                     // low
    svc('Active', 900, 'private', { modified: ago(10), usage: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]] }), // not stale
  ]);
  const ev = evaluate(data, T);
  const order = ev.families.map((r) => [r.source.title, r.priority]);
  assert.deepEqual(order, [['Big org unused', 'start'], ['Medium private', 'start'], ['Big org some use', 'look'], ['Big public used', 'low'], ['Tiny', 'low']]);
  for (const r of ev.families) assert.equal(typeof r.priorityReason, 'string');
});

test('owners carry a count of "quick win" families', () => {
  const data = mk([
    svc('a1', 300, 'private'), svc('a2', 200, 'private'), svc('a3', 0.5, 'private'),
    svc('b1', 0.4, 'private', { owner: 'bob' }),
  ]);
  const ev = evaluate(data, T);
  const by = Object.fromEntries(ev.owners.map((o) => [o.owner.username, o.startCount]));
  assert.deepEqual(by, { amy: 2, bob: 0 });
});

test('depsKnown=false: Quick win is capped at Worth a look, with a still-checking reason', () => {
  const r = prow([120, 'private', 0, null]);
  const got = priorityOf(r, [r], { depsKnown: false });
  assert.equal(got.priority, 'look');
  assert.match(got.reason, /^Worth a look: .*still checking maps and apps/);
  const wide = prow([120, 'public', 3, null]); // used-by is unknown, so it can't be called low on that either
  assert.equal(priorityOf(wide, [wide], { depsKnown: false }).priority, 'look');
  const small = prow([0.5, 'private', 0, null]);
  assert.equal(priorityOf(small, [small, prow([100, 'private', 0, null]), prow([100, 'private', 0, null]), prow([100, 'private', 0, null])], { depsKnown: false }).priority, 'low');
});

test('depsKnown=false: the used-by threshold is not applied, so more rows are stale', () => {
  const data = mk([svc('Mapped', 100, 'private', { dependencies: [dep, { ...dep, id: 'd2' }, { ...dep, id: 'd3' }] })]);
  assert.equal(evaluate(data, T).families.length, 0); // 3 maps > maxUsedBy 1
  const ev = evaluate(data, T, { depsKnown: false });
  assert.equal(ev.families.length, 1);
  assert.equal(ev.families[0]?.priority, 'look');
});
