// DC-053: a service's size can be unknown (lazy sizing on big orgs, or a stopped scan). Written test-first.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { allRows, evaluate } from './stale';
import { priorityOf, sortRows } from './priority';
import type { Data, Service, Thresholds } from './types';

const SCAN = '2026-10-10T09:00:00Z';
const DAY = 86400000;
const isoAgo = (d: number) => new Date(Date.parse(SCAN) - d * DAY).toISOString();
let n = 0;
const hex = () => (++n).toString(16).padStart(32, '0');
const svc = (title: string, sizeMB: number | null, o: Partial<Service> = {}): Service => ({
  id: hex(), title, owner: 'amy', created: isoAgo(900), modified: isoAgo(800), sizeMB,
  access: 'private', isView: false, sourceId: null, usage: [], dependencies: [], ...o,
});
const mk = (services: Service[]): Data => ({
  org: { id: 'o', name: 'Org', urlKey: 'org', scannedAt: SCAN },
  owners: [{ username: 'amy', fullName: 'Amy A', disabled: false, thumbnail: null, lastNotified: null }],
  services,
});
const T: Thresholds = { minDaysSinceUse: 180, minDaysSinceUpdate: 365, maxUsedBy: 1 };

test('a family with an unmeasured source is sizeKnown false, with 0 MB and 0 credits counted', () => {
  const ev = evaluate(mk([svc('Unmeasured', null), svc('Measured', 100)]), T);
  const u = ev.families.find((r) => r.source.title === 'Unmeasured');
  assert.ok(u);
  assert.equal(u.sizeKnown, false);
  assert.equal(u.sizeMB, 0);
  assert.equal(u.credits, 0);
  assert.equal(ev.families.find((r) => r.source.title === 'Measured')?.sizeKnown, true);
});

test('totals count only known sizes and say how many are still unmeasured', () => {
  const ev = evaluate(mk([svc('A', null), svc('B', null), svc('C', 100)]), T);
  assert.equal(ev.totals.credits, 24);
  assert.equal(ev.totals.sizeMB, 100);
  assert.equal(ev.totals.unmeasured, 2);
  assert.equal(ev.owners[0]?.unmeasured, 2);
  assert.equal(ev.owners[0]?.credits, 24);
});

test('views never make a family unknown: only non-view members carry storage', () => {
  const src = svc('Source', 50);
  const view = svc('View', null, { isView: true, sourceId: src.id });
  const ev = evaluate(mk([src, view]), T);
  assert.equal(ev.families.length, 1);
  assert.equal(ev.families[0]?.sizeKnown, true);
  assert.equal(ev.totals.unmeasured, 0);
});

test('"Size: at least" never hides an unmeasured row; it is shown as not yet known', () => {
  const data = mk([svc('Small', 1), svc('Unknown', null), svc('Big', 500)]);
  const ev = evaluate(data, { ...T, minSizeMB: 100 });
  assert.deepEqual(ev.families.map((r) => r.source.title).sort(), ['Big', 'Unknown']);
  assert.equal(ev.totals.unmeasured, 1);
});

test('sort by credits puts unknown sizes last, even after zero-credit rows', () => {
  const rows = allRows(mk([svc('Unknown', null), svc('Zero', 0), svc('Big', 500), svc('Mid', 20)]), T);
  assert.deepEqual(sortRows(rows, 'credits').map((r) => r.source.title), ['Big', 'Mid', 'Zero', 'Unknown']);
});

test('priority: an unmeasured family is Worth a look (not Low impact on size, never a Quick win), and the reason says why', () => {
  const row = { credits: 0, sizeMB: 0, sizeKnown: false, usedBy: 0, lastUsedDaysAgo: null, source: { access: 'private' } };
  const got = priorityOf(row, [row, { credits: 100 }, { credits: 100 }]);
  assert.equal(got.priority, 'look');
  assert.match(got.reason, /^Worth a look: size not measured yet, /);
});

test('priority cutoffs ignore unmeasured rows (their 0 credits would drag the bottom third down)', () => {
  // Known: half a megabyte on its own is Low impact. Counted as 0 credits, the unknown rows would make it a Quick win.
  const rows = allRows(mk([svc('Half MB', 0.5), svc('U1', null), svc('U2', null), svc('U3', null)]), T);
  assert.equal(rows.find((r) => r.source.title === 'Half MB')?.priority, 'low');
});
