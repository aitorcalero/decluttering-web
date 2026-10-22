import { describe, expect, it } from 'vitest';
import type { Data, Dependency, Owner, Service } from '../../domain/types';
import { SMALL_LAYER_MB, buildDots, dotWhy, rampK, ringed, withSmallFloor, type Dot, type DotModel } from './dots';
import { Y_BAND, lensPoint, rampColour, staleZone, xUpdate, yLastUsed } from './dot-layout';
import { PRESETS } from '../../domain/stale';

const SCAN = '2026-10-10T09:00:00Z';
const DAY = 86400000;
const isoAgo = (d: number) => new Date(Date.parse(SCAN) - d * DAY).toISOString();
let n = 0;
const hex = () => (++n).toString(16).padStart(32, '0');
const svc = (o: Partial<Service> = {}): Service => ({
  id: hex(), title: `Service ${n}`, owner: 'amy', created: isoAgo(900), modified: isoAgo(800), sizeMB: 50,
  access: 'private', isView: false, sourceId: null, usage: [], dependencies: [], ...o,
});
const dep = (i: number): Dependency => ({ id: `d${i}`, title: `Map ${i}`, type: 'Web Map', owner: 'amy' });
const owners: Owner[] = [
  { username: 'amy', fullName: 'Amy A', disabled: false, thumbnail: null, lastNotified: null },
  { username: 'dee', fullName: 'Dee D', disabled: true, thumbnail: null, lastNotified: null },
];
const mk = (services: Service[]): Data => ({ org: { id: 'o', name: 'Org', urlKey: 'org', scannedAt: SCAN }, owners, services });

describe('dot map model (DC-064)', () => {
  it('before the core: one grey dot per service found, light until its size is read', () => {
    const found = [{ id: 'a', title: 'A', owner: 'amy' }, { id: 'b', title: 'B', owner: 'amy' }];
    const m = buildDots({ found, sized: new Map([['b', 12]]), data: null, depsKnown: false });
    expect(m.revealed).toBe(false);
    expect(m.dots.map((d) => [d.id, d.kind, d.sizeMB])).toEqual([['a', 'pending', 0], ['b', 'sized', 12]]);
    expect(m.stats).toEqual({ found: 2, staleServices: 0, credits: 0, sizeMB: 0 });
    expect(m.maxSizeMB).toBe(12);
  });

  it('after the core: one dot per family in found order, stale under Balanced, views folded in', () => {
    const stale = svc({ sizeMB: 40 });
    const view = svc({ isView: true, sourceId: stale.id, sizeMB: 0 });
    const fresh = svc({ modified: isoAgo(10), usage: [[1, 5], [2, 5], [3, 5]] });
    const small = svc({ sizeMB: 1 }); // below Balanced's 15 MB floor
    const data = mk([fresh, stale, view, small]);
    const found = [fresh, stale, view, small].map((s) => ({ id: s.id, title: s.title, owner: s.owner }));
    const m = buildDots({ found, sized: new Map(), data, depsKnown: true });
    expect(m.revealed).toBe(true);
    expect(m.dots.map((d) => d.id)).toEqual([fresh.id, stale.id, small.id]);
    expect(m.dots.map((d) => d.kind)).toEqual(['fine', 'stale', 'fine']);
    const s = m.dots[1];
    expect(s?.nSvc).toBe(2);
    expect(s?.candidate).toBe(true);
    expect(m.stats.staleServices).toBe(2);
    expect(m.stats.credits).toBeCloseTo((40 / 10) * 2.4);
  });

  it('while maps and apps are read, a used service still looks stale; once known it settles to grey with a ring', () => {
    const used = svc({ dependencies: [dep(1), dep(2)] });
    const data = mk([used]);
    const before = buildDots({ found: [], sized: new Map(), data, depsKnown: false });
    expect(before.dots[0]?.kind).toBe('stale');
    const after = buildDots({ found: [], sized: new Map(), data, depsKnown: true });
    expect(after.dots[0]?.kind).toBe('fine');
    expect(after.dots[0]?.candidate).toBe(true); // in the zone, too used to count
    expect(ringed(after.dots[0] as never, 'stale')).toBe(true);
  });

  it('the tip never says "not used by any maps or apps" before maps and apps are read (as the review does)', () => {
    const data = mk([svc({})]);
    expect(dotWhy(buildDots({ found: [], sized: new Map(), data, depsKnown: false }).dots[0]!)).toMatch(/used by: still checking…$/);
    expect(dotWhy(buildDots({ found: [], sized: new Map(), data, depsKnown: true }).dots[0]!)).toMatch(/no maps or apps use it$/);
  });

  it('a view not yet linked to its source is marked, so the size floor leaves it alone', () => {
    const v = svc({ isView: true, sourceId: null, sizeMB: 0 });
    const m = buildDots({ found: [], sized: new Map(), data: mk([v]), depsKnown: false });
    expect(m.dots[0]?.view).toBe(true);
  });

  it('rings outside the zone only on the "Used by maps" lens', () => {
    const d = { usedBy: 2, candidate: false };
    expect(ringed(d, 'stale')).toBe(false);
    expect(ringed(d, 'used')).toBe(true);
    expect(ringed({ usedBy: 0, candidate: true }, 'used')).toBe(false);
  });

  it('disabled owners count on the map but not in "Credits you could save" (same totals as the review)', () => {
    const data = mk([svc({ owner: 'dee', sizeMB: 100 }), svc({ sizeMB: 20 })]);
    const m = buildDots({ found: [], sized: new Map(), data, depsKnown: true });
    expect(m.dots.filter((d) => d.kind === 'stale')).toHaveLength(2);
    expect(m.stats.staleServices).toBe(1);
    expect(m.stats.sizeMB).toBe(20);
  });

  it('colour ramp: amber for barely stale, raspberry for very stale', () => {
    expect(rampColour(0)).toBe('rgb(250,166,26)');
    expect(rampColour(1)).toBe('rgb(176,31,89)');
    expect(rampK({ staleness: 1 }, 0.3)).toBe(1);
    expect(rampK({ staleness: 0.3 }, 0.3)).toBe(0);
  });

  it('layout (DC-083): last updated across, last used up; the Balanced zone starts at 6 months on both; 3 years+ is a band', () => {
    const z = staleZone(PRESETS.balanced);
    expect(z.x).toBeCloseTo(xUpdate(180, 0));
    expect(z.y).toBeCloseTo(yLastUsed(180));
    expect(xUpdate(5000, 1)).toBeGreaterThan(0.9);
    const at = (used: number | null, upd: number) => lensPoint('stale', { usedBy: 0, lastUsedDaysAgo: used, daysSinceUpdate: upd, sizeMB: 1, staleness: 1 }, 3, PRESETS.balanced, 10);
    const [x, y] = at(null, 800);  // no use recorded: the top band, inside the zone
    expect(x).toBeGreaterThan(z.x); expect(y).toBeGreaterThan(z.y); expect(y).toBeGreaterThanOrEqual(Y_BAND[0]);
    expect(at(200, 200)[1]).toBeGreaterThan(z.y);   // used 200 days ago: in the zone
    expect(at(100, 200)[1]).toBeLessThan(z.y);      // used 100 days ago: below it
    for (const d of [0, 30, 90, 180, 365, 730, 2000]) expect(yLastUsed(d)).toBeLessThan(Y_BAND[0]);
    for (let d = 1; d < 900; d += 7) expect(yLastUsed(d)).toBeGreaterThan(yLastUsed(d - 1)); // longer ago is higher
  });

  it('a dot carries last used, and its tip says "Last used"', () => {
    const recent = svc({ lastViewed: isoAgo(10) });
    const m = buildDots({ found: [], sized: new Map(), data: mk([recent]), depsKnown: true });
    expect(m.dots[0]).toMatchObject({ lastUsedDaysAgo: 10, kind: 'fine' });
    expect(dotWhy(m.dots[0]!)).toMatch(/^Last used 10 days ago · /);
  });

  describe('DC-071c: dots on the "How stale" lens as soon as usage and last-updated are in', () => {
    const end = Date.parse(SCAN);
    const at = (ago: number) => end - ago * DAY;
    const found = [
      { id: 'a', title: 'A', owner: 'amy', url: 'https://x/rest/services/Alpha/FeatureServer', modified: at(800) },
      { id: 'b', title: 'B', owner: 'amy', url: 'https://x/rest/services/Beta/FeatureServer', modified: at(10) },
      { id: 'v', title: 'View', owner: 'amy', url: 'https://x/rest/services/Vw/FeatureServer', modified: at(800), isView: true },
    ];
    const usage = { end, byName: new Map([['beta', new Map([[at(1), 4], [at(2), 4], [at(3), 4], [at(4), 4]])]]) };

    it('places dots on the lens without sizes or view links; unknown size is a small unmeasured dot', () => {
      const m = buildDots({ found, sized: new Map(), data: null, depsKnown: false, usage });
      expect(m.revealed).toBe(true);
      expect(m.exact).toBe(false);
      expect(m.dots.map((d) => d.id)).toEqual(['a', 'b', 'v']); // a view stands alone until the core links it
      const [a, b] = m.dots;
      expect(a?.sized).toBe(false);
      expect(a?.lastUsedDaysAgo).toBe(null);
      expect(a?.daysSinceUpdate).toBe(800);
      expect(b?.lastUsedDaysAgo).toBe(1);
      expect(b?.daysSinceUpdate).toBe(10);
      expect(m.stats).toEqual({ found: 3, staleServices: 0, credits: 0, sizeMB: 0 }); // totals are not real yet
    });

    it('a size that arrives later grows its dot', () => {
      const m = buildDots({ found, sized: new Map([['a', 40]]), data: null, depsKnown: false, usage });
      expect(m.dots[0]).toMatchObject({ sized: true, sizeMB: 40 });
      expect(m.maxSizeMB).toBe(40);
    });

    it('waits for the grey grid until usage is complete or the search has no dates', () => {
      expect(buildDots({ found, sized: new Map(), data: null, depsKnown: false, usage: null }).revealed).toBe(false);
      expect(buildDots({ found: [{ id: 'z', title: 'Z', owner: 'amy' }], sized: new Map(), data: null, depsKnown: false, usage }).revealed).toBe(false);
    });
  });
});

describe('small-layer display floor (DC-079)', () => {
  const dot = (id: string, o: Partial<Dot> = {}): Dot => ({
    id, title: id, owner: 'amy', sizeMB: 1, sized: true, credits: 0.24, kind: 'fine', candidate: false, staleness: 0.5,
    usedBy: 0, lastUsedDaysAgo: null, daysSinceUpdate: 0, nSvc: 1, why: '', ...o,
  });
  const model = (dots: Dot[]): DotModel => ({
    dots, revealed: true, exact: true, staleMin: 0.3, maxSizeMB: 80,
    stats: { found: 99, staleServices: 3, credits: 12, sizeMB: 500 },
  });
  const m = model([
    dot('small', { sizeMB: 1, credits: 0.24 }),
    dot('small2', { sizeMB: 2, credits: 0.48 }),
    dot('big', { sizeMB: 80, credits: 19.2 }),
    dot('edge', { sizeMB: SMALL_LAYER_MB }),
    dot('unmeasured', { sized: false, sizeMB: 0, kind: 'pending' }),
    dot('stale-small', { sizeMB: 1, kind: 'stale' }),
    dot('candidate-small', { sizeMB: 1, candidate: true }),
  ]);

  it('the floor is 3 MB', () => expect(SMALL_LAYER_MB).toBe(3));

  it('hides measured fine dots under the floor and reports them', () => {
    const r = withSmallFloor(m, { floorMB: 3, show: false });
    expect(r.model.dots.map((d) => d.id)).toEqual(['big', 'edge', 'unmeasured', 'stale-small', 'candidate-small']);
    expect(r.hidden.count).toBe(2);
    expect(r.hidden.sizeMB).toBeCloseTo(3);
    expect(r.hidden.credits).toBeCloseTo(0.72);
  });

  it('keeps unmeasured dots until their size is known', () => {
    const r = withSmallFloor(model([dot('u', { sized: false, sizeMB: 0, kind: 'pending' })]), { floorMB: 3, show: false });
    expect(r.model.dots).toHaveLength(1);
    expect(r.hidden.count).toBe(0);
  });

  it('never hides stale or candidate dots, however small', () => {
    const r = withSmallFloor(model([dot('s', { kind: 'stale' }), dot('c', { candidate: true }), dot('v', { view: true, sizeMB: 0, credits: 0 })]), { floorMB: 3, show: false });
    expect(r.model.dots.map((d) => d.id)).toEqual(['s', 'c', 'v']);
    expect(r.hidden.count).toBe(0);
  });

  it('with show on, hides nothing but still counts', () => {
    const r = withSmallFloor(m, { floorMB: 3, show: true });
    expect(r.model.dots).toHaveLength(m.dots.length);
    expect(r.hidden.count).toBe(2);
  });

  it('leaves stats and maxSizeMB alone, and returns the same model when nothing is hidden', () => {
    const r = withSmallFloor(m, { floorMB: 3, show: false });
    expect(r.model.stats).toEqual(m.stats);
    expect(r.model.maxSizeMB).toBe(80);
    const none = model([dot('big', { sizeMB: 80 })]);
    expect(withSmallFloor(none, { floorMB: 3, show: false }).model).toBe(none);
  });

  describe('FB-43: "no storage" dots on How big', () => {
    const ns = model([
      dot('view', { view: true, sizeMB: 0, credits: 0 }),
      dot('stale-empty', { sizeMB: 0, credits: 0, kind: 'stale' }),
      dot('small', { sizeMB: 1, credits: 0.24 }),
      dot('empty-fine', { sizeMB: 0, credits: 0 }), // under the floor already: counted there, not twice
      dot('unmeasured', { sized: false, sizeMB: 0, kind: 'pending' }),
      dot('big', { sizeMB: 80 }),
    ]);

    it('hides them with the small layers and counts them apart', () => {
      const r = withSmallFloor(ns, { floorMB: 3, show: false, hideNoStorage: true });
      expect(r.model.dots.map((d) => d.id)).toEqual(['unmeasured', 'big']);
      expect(r.hidden.count).toBe(2);
      expect(r.hidden.noStorage).toBe(2);
    });

    it('Show them brings both back', () => {
      const r = withSmallFloor(ns, { floorMB: 3, show: true, hideNoStorage: true });
      expect(r.model.dots).toHaveLength(ns.dots.length);
      expect(r.hidden).toMatchObject({ count: 2, noStorage: 2 });
    });

    it('other lenses keep them (they are real families there, DC-079)', () => {
      const r = withSmallFloor(ns, { floorMB: 3, show: false });
      expect(r.model.dots.map((d) => d.id)).toEqual(['view', 'stale-empty', 'unmeasured', 'big']);
      expect(r.hidden.noStorage).toBe(0);
    });
  });
});

describe('DC-082: before usage is in, dots know when they were last updated', () => {
  it('takes days since update from the search, so the map can place them across before usage lands', () => {
    const now = Date.parse(SCAN);
    const found = [{ id: 'a', title: 'A', owner: 'amy', modified: now - 400 * DAY }, { id: 'b', title: 'B', owner: 'amy', modified: now - 2 * DAY, isView: true }];
    const m = buildDots({ found, sized: new Map(), data: null, depsKnown: false, now });
    expect(m.revealed).toBe(false);
    expect(m.timed).toBe(true);
    expect(m.dots.map((d) => d.daysSinceUpdate)).toEqual([400, 2]);
    expect(m.dots[1]?.view).toBe(true);
  });

  it('without dates from the search it is not timed (the map falls back to the grid)', () => {
    const m = buildDots({ found: [{ id: 'a', title: 'A', owner: 'amy' }], sized: new Map(), data: null, depsKnown: false });
    expect(m.timed).toBe(false);
    expect(m.dots[0]?.daysSinceUpdate).toBe(0);
  });
});
