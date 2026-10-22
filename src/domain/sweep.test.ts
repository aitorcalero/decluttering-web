// DC-086: sweep detection for "last used". Test-first.
import { describe, expect, it } from 'vitest';
import type { Data, Service, Thresholds } from './types';
import { allRows, evaluate, families, lastUsedWords, sweepsOf, useOf } from './stale';
import { suggest } from './suggest';
import { buildDots } from '../ui/scan/dots';
import {
  SWEEP_DAY_SHARE, SWEEP_HEAVY_REQUESTS, SWEEP_MAX_MEDIAN, SWEEP_MIN_FAMILIES, SWEEP_MIN_SERVICES,
  sweepDays, sweepHours, sweepNote, sweepSummary,
} from './sweep';

const SCAN = '2026-10-17T09:00:00Z';
const REF = Date.parse(SCAN);
const DAY = 864e5, HOUR = 36e5;
const isoAgo = (d: number) => new Date(REF - d * DAY).toISOString();

let n = 0;
const svc = (o: Partial<Service> = {}): Service => ({
  id: `s${++n}`, title: `Layer ${n}`, owner: `owner${n % 7}`, created: isoAgo(1500), modified: isoAgo(1200), sizeMB: 30,
  access: 'private', isView: false, sourceId: null, usage: [], dependencies: [], ...o,
});
const owners = () => Array.from({ length: 7 }, (_, i) => ({ username: `owner${i}`, fullName: `Owner ${i}`, disabled: false, thumbnail: null, lastNotified: null }));
const mk = (services: Service[]): Data => ({ org: { id: 'o1', name: 'Org', urlKey: 'org', scannedAt: SCAN }, owners: owners(), services });
const RULE: Thresholds = { minDaysSinceUse: 180, minDaysSinceUpdate: 0, maxUsedBy: 99, minSizeMB: 0 };
const unused = (d: Data, countSweeps = false) => allRows(d, RULE, { countSweeps }).filter((r) => r.stale).length;

/**
 * A big org in miniature: 400 layers. On days 10 and 60 a script touched 360 of them with 2 requests each. Five layers
 * were genuinely busy on day 10 (50 requests), and 20 were used on day 30 by people (an ordinary day, not a sweep).
 */
function bigOrg(): { data: Data; busy: Service[]; people: Service[] } {
  const services: Service[] = [];
  for (let i = 0; i < 400; i++) {
    const usage: [number, number][] = [];
    if (i < 360) usage.push([10, i < 5 ? 50 : 2], [60, 2]);
    if (i >= 100 && i < 120) usage.push([30, 3]);
    services.push(svc({ usage: usage.sort((a, b) => a[0] - b[0]) }));
  }
  return { data: mk(services), busy: services.slice(0, 5), people: services.slice(100, 120) };
}

describe('sweep days', () => {
  it('the constants are the brief\'s judgement values', () => {
    expect([SWEEP_DAY_SHARE, SWEEP_MIN_SERVICES, SWEEP_MAX_MEDIAN, SWEEP_MIN_FAMILIES, SWEEP_HEAVY_REQUESTS]).toEqual([0.25, 50, 5, 50, 10]);
  });

  it('finds the light-touch days on a big org, not the ordinary busy day', () => {
    const { data } = bigOrg();
    expect([...sweepDays(data.services)].sort((a, b) => a - b)).toEqual([10, 60]);
  });

  it('"unused for 180 days" ignores the light touches and keeps the busy layers', () => {
    const { data, busy, people } = bigOrg();
    expect(unused(data)).toBe(400 - 5 - 20);
    const rows = allRows(data, RULE);
    for (const s of busy) expect(rows.find((r) => r.source.id === s.id)?.lastUsedDaysAgo).toBe(10);
    for (const s of people) expect(rows.find((r) => r.source.id === s.id)?.lastUsedDaysAgo).toBe(30);
    const touched = rows.find((r) => r.source.id === data.services[200]!.id)!;
    expect(touched.lastUsedDaysAgo).toBeNull();
    expect(lastUsedWords(touched)).toBe('No data requests in the last year');
  });

  it('the setting counts sweep days like any other use', () => {
    const { data } = bigOrg();
    expect(unused(data, true)).toBe(40);
    expect(allRows(data, RULE, { countSweeps: true }).find((r) => r.source.title === data.services[200]!.title)?.lastUsedDaysAgo).toBe(10);
  });

  it('a layer with more than 10 requests across its family on a sweep day still counts', () => {
    const { data } = bigOrg();
    const src = data.services[300]!;
    const view = svc({ isView: true, sourceId: src.id, usage: [[10, 9]], sizeMB: 0 });
    const d = { ...data, services: [...data.services, view] };
    // family total on day 10: 2 + 9 = 11 requests, above the light-touch limit
    expect(allRows(d, RULE).find((r) => r.source.id === src.id)?.lastUsedDaysAgo).toBe(10);
  });

  it('a 79-layer org with an ordinary busy day finds no sweep', () => {
    const services: Service[] = [];
    for (let i = 0; i < 79; i++) {
      const usage: [number, number][] = [];
      if (i < 45) usage.push([5, 1 + (i % 4)]);           // 57% of layers, light counts, but only 45 layers
      if (i < 60) usage.push([12, 8 + (i % 30)]);         // 60 layers, but a median well over 5: people at work
      services.push(svc({ usage: usage.sort((a, b) => a[0] - b[0]) }));
    }
    const data = mk(services);
    expect(sweepDays(data.services).size).toBe(0);
    expect(sweepSummary(sweepsOf(data), REF)).toBeNull();
  });

  it('a share under 25% is not a sweep, however many layers', () => {
    const services = Array.from({ length: 1000 }, (_, i) => svc({ usage: i < 240 ? [[3, 1]] : [] }));
    expect(sweepDays(services).size).toBe(0);
    services.push(...Array.from({ length: 20 }, () => svc({ usage: [[3, 1]] })));
    expect([...sweepDays(services)]).toEqual([3]); // 260 of 1,020
  });
});

describe('sweep hours (lastViewed)', () => {
  /** 200 layers with lastViewed: 120 of them share 02:00 to 02:59 UTC three days before the scan. */
  function viewedOrg(): Data {
    const sweepAt = Date.UTC(2026, 9, 14, 2, 0, 0);
    return mk(Array.from({ length: 200 }, (_, i) => svc({
      lastViewed: new Date(i < 120 ? sweepAt + (i % 59) * 60_000 : REF - (20 + i) * DAY - (i % 24) * HOUR).toISOString(),
      usage: i < 5 ? [[3, 1]] : [],
    })));
  }

  it('finds an hour that holds at least 25% of families\' newest lastViewed', () => {
    const data = viewedOrg();
    expect([...sweepHours(families(data))]).toEqual([Math.floor(Date.UTC(2026, 9, 14, 2) / HOUR)]);
  });

  it('a lastViewed in a sweep hour is set aside; with nothing left it is "No data requests in the last year"', () => {
    const data = viewedOrg();
    const rows = allRows(data, RULE);
    const swept = rows.find((r) => r.source.title === data.services[50]!.title)!;
    expect(swept.lastUsedDaysAgo).toBeNull();
    expect(swept.noUseRecorded).toBe(false);
    expect(swept.useKnown).toBe(true);
    expect(lastUsedWords(swept)).toBe('No data requests in the last year');
    // a light request on day 3 is not a sweep day (5 layers), so it still counts
    expect(rows.find((r) => r.source.title === data.services[2]!.title)?.lastUsedDaysAgo).toBe(3);
    // the rest keep their own lastViewed
    expect(rows.find((r) => r.source.title === data.services[150]!.title)?.lastUsedDaysAgo).toBe(170);
    expect(allRows(data, RULE, { countSweeps: true }).find((r) => r.source.title === data.services[50]!.title)?.lastUsedDaysAgo).toBe(3);
  });

  it('a set-aside lastViewed does not claim more than the year of requests read', () => {
    const data = viewedOrg();
    const f = families(data).find((x) => x.source.title === data.services[50]!.title)!;
    const u = useOf([f.source], REF, sweepsOf(data));
    expect(u.swept).toBe(true);
    const two = allRows(data, { ...RULE, minDaysSinceUse: 730 }).find((r) => r.source.id === f.source.id)!;
    expect(two.useKnown).toBe(false);
    expect(two.stale).toBe(false);
  });

  it('needs at least 50 families in the hour', () => {
    const at = Date.UTC(2026, 9, 14, 2, 0, 0);
    const small = mk(Array.from({ length: 100 }, (_, i) => svc({ lastViewed: new Date(i < 49 ? at : REF - (20 + i) * DAY).toISOString() })));
    expect(sweepHours(families(small)).size).toBe(0);
  });
});

describe('saying so', () => {
  it('names the most recent date and how many others, in Australian format', () => {
    const { data } = bigOrg();
    const s = sweepSummary(sweepsOf(data), REF)!;
    expect(s).toEqual({ dates: 2, latestDaysAgo: 10, latest: '7 Oct 2026' });
    expect(sweepNote(s, false)).toEqual({
      text: "On 7 Oct 2026 and 1 other day, a script or crawler likely touched many layers at once. Last used skips those light touches.",
      action: 'Count them',
    });
    expect(sweepNote({ ...s, dates: 15 }, false).text).toMatch(/^On 7 Oct 2026 and 14 other days, /);
    expect(sweepNote({ ...s, dates: 1 }, false).text).toMatch(/^On 7 Oct 2026, a script or crawler/);
    expect(sweepNote(s, true)).toEqual({
      text: 'On 7 Oct 2026 and 1 other day, a script or crawler likely touched many layers at once. Those days count as use, as you asked.',
      action: 'Set them aside',
    });
  });

  it('counts a sweep day and a sweep hour on the same date once', () => {
    const { data } = bigOrg();
    const at = REF - 10 * DAY; // the same UTC date as sweep day 10
    const d = { ...data, services: data.services.map((s, i) => (i < 150 ? { ...s, lastViewed: new Date(Math.floor(at / HOUR) * HOUR).toISOString() } : s)) };
    expect(sweepSummary(sweepsOf(d), REF)?.dates).toBe(2);
  });

  it('is null when nothing was found', () => {
    expect(sweepSummary(sweepsOf(mk([svc({ usage: [[1, 1]] })])), REF)).toBeNull();
  });
});

describe('review, Suggested and the dot map agree', () => {
  it('on the same sweep-aware last used, with the setting off and on', () => {
    const { data } = bigOrg();
    for (const countSweeps of [false, true]) {
      const sug = suggest(data, { countSweeps });
      expect(sug).not.toBeNull();
      const t = sug!.thresholds;
      const review = evaluate(data, t, { countSweeps }).families.length;
      expect(sug!.flagged).toBe(review);
      const dots = buildDots({ found: [], sized: new Map(), data, depsKnown: true, countSweeps }, t);
      expect(dots.dots.filter((x) => x.kind === 'stale').length).toBe(review);
      const lastUsed = new Map(allRows(data, t, { countSweeps }).map((r) => [r.source.id, r.lastUsedDaysAgo]));
      for (const dot of dots.dots) expect(dot.lastUsedDaysAgo).toBe(lastUsed.get(dot.id));
      expect(dots.sweeps).toEqual(sweepSummary(sweepsOf(data), REF) && { ...sweepSummary(sweepsOf(data), REF)!, counting: countSweeps });
    }
  });
});
