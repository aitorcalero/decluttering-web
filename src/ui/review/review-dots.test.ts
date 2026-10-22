// DC-090 (FB-40): the Review page's dot map follows the panel's rule through the same domain functions as the list.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRESETS, evaluate } from '../../domain/stale';
import type { Data, Thresholds } from '../../domain/types';
import { buildDots } from '../scan/dots';
import { lensPoint, staleZone } from '../scan/dot-layout';
import { readChartView, reviewDots, writeChartView, zoneName } from './review-dots';

const data = JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo/mock-small.json'), 'utf8')) as Data;
const disabled = new Set(data.owners.filter((o) => o.disabled).map((o) => o.username));
const ownerOf = new Map(data.services.map((s) => [s.id, s.owner]));
const RULES: [string, Thresholds][] = [
  ['gentle', PRESETS.gentle], ['balanced', PRESETS.balanced], ['strict', PRESETS.strict],
  ['custom', { ...PRESETS.balanced, minDaysSinceUpdate: 90, minDaysSinceUse: 30, maxUsedBy: 2, minSizeMB: 0 }],
];

describe('reviewDots', () => {
  for (const [name, t] of RULES) {
    for (const countSweeps of [false, true]) {
      it(`the stale dots are the list (${name}, countSweeps ${countSweeps})`, () => {
        const ev = evaluate(data, t, { depsKnown: true, countSweeps });
        const m = reviewDots(data, t, { depsKnown: true, countSweeps });
        // Reachable stale dots are exactly the list's families; disabled owners' stale dots are "No one to nudge".
        const stale = m.dots.filter((d) => d.kind === 'stale');
        const reachable = stale.filter((d) => !disabled.has(ownerOf.get(d.id) ?? '')).map((d) => d.id).sort();
        expect(reachable).toEqual(ev.families.map((r) => r.source.id).sort());
        expect(stale.length).toBe(ev.families.length + ev.totals.unreachableFamilies);
        // The count on the card is the list's service count.
        expect(m.stats.staleServices).toBe(ev.totals.services);
      });
    }
  }

  it('changing a filter recolours the dots and moves the stale zone', () => {
    const a = reviewDots(data, PRESETS.gentle, { depsKnown: true, countSweeps: false });
    const b = reviewDots(data, PRESETS.strict, { depsKnown: true, countSweeps: false });
    const kinds = (m: typeof a) => new Map(m.dots.map((d) => [d.id, d.kind]));
    const ka = kinds(a), kb = kinds(b);
    expect([...ka].some(([id, k]) => kb.get(id) !== k)).toBe(true);
    expect(staleZone(PRESETS.gentle)).not.toEqual(staleZone(PRESETS.strict));
  });

  it('is the scan map\'s model: same dots, and the same How stale lensPoint for each', () => {
    // The scan screen calls buildDots(found, sized, data, depsKnown) once the core is in; Review passes no found list.
    const found = data.services.map((s) => ({ id: s.id, title: s.title, owner: s.owner }));
    const scan = buildDots({ found, sized: new Map(), data, depsKnown: true }, PRESETS.balanced);
    const review = reviewDots(data, PRESETS.balanced, { depsKnown: true, countSweeps: false });
    const byId = new Map(scan.dots.map((d) => [d.id, d]));
    expect(review.dots.length).toBe(scan.dots.length);
    for (const d of review.dots) {
      const s = byId.get(d.id);
      expect(s).toBeDefined();
      expect(lensPoint('stale', d, 7, PRESETS.balanced, review.maxSizeMB)).toEqual(lensPoint('stale', s!, 7, PRESETS.balanced, scan.maxSizeMB));
    }
  });

  it('labels the zone with the starting point, or "your rule" for Custom', () => {
    expect(zoneName('suggested')).toBe('Suggested');
    expect(zoneName('balanced')).toBe('Balanced');
    expect(zoneName('custom')).toBe('your rule');
  });
});

describe('DC-112 (FB-68): the saved view lives under the app prefix, so a reset clears it', () => {
  it('writes only decluttering: keys, never the old dc.review one', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    try {
      store.set('dc.review.chartView', 'owner'); // an old pick under the former key is ignored
      expect(readChartView('org1')).toBe('stale');
      writeChartView('owner', 'org1');
      expect([...store.keys()].filter((k) => k !== 'dc.review.chartView').every((k) => k.startsWith('decluttering:'))).toBe(true);
    } finally { g.localStorage = prev; }
  });
});

describe('DC-112 (FB-75): the remembered view is per org', () => {
  it('a pick in one org does not change what another org (or the demo) opens on', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    try {
      store.set('dc.review.chartView', 'owner'); // the former shared key
      expect(readChartView('DEMO')).toBe('stale');
      writeChartView('owner', 'REAL');
      expect(readChartView('REAL')).toBe('owner');
      expect(readChartView('DEMO')).toBe('stale');
    } finally { g.localStorage = prev; }
  });
});
