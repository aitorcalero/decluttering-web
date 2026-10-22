import { describe, expect, it } from 'vitest';
import * as ts from './estimate';
// Prototype D is not in the public copy (DC-104): the parity checks run only where it exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Estimate = any;
const protoLoad = Object.values(import.meta.glob('../../../prototypes/d-converged/estimate.js'))[0];
const js = (protoLoad ? await protoLoad() : null) as Estimate | null;

type S = { t: number; f: number };
/** Samples every second from 0 to `end` s, f given by fn(seconds). */
const run = (end: number, fn: (s: number) => number): S[] => Array.from({ length: end + 1 }, (_, s) => ({ t: s * 1000, f: fn(s) }));

const impls: [string, Estimate][] = js ? [['app', ts], ['prototype', js]] : [['app', ts]];
const ids = ['find', 'size', 'views', 'usage', 'owners', 'deps'];

describe.each(impls)('estimateRemaining (%s)', (_n, m) => {
  it('steady rate: 1% a second, 20% done, about 80 s left, said as about 1 minute', () => {
    const e = m.estimateRemaining(run(20, (s: number) => s * 0.01));
    expect(e.text).toBe('about 1 minute left');
    expect(e.ms).toBeGreaterThan(75000); expect(e.ms).toBeLessThan(85000);
  });
  it('says minutes, rounded, never seconds', () => {
    expect(m.estimateRemaining(run(30, (s: number) => s * 0.001)).text).toBe('about 16 minutes left');
  });
  it('under a minute when little is left', () => {
    expect(m.estimateRemaining(run(40, (s: number) => 0.5 + s * 0.01)).text).toBe('under a minute left');
  });
  it('hidden before 15 s', () => { expect(m.estimateRemaining(run(14, (s: number) => s * 0.01))).toBeNull(); });
  it('hidden when nothing measurable moved', () => { expect(m.estimateRemaining(run(30, () => 0.2))).toBeNull(); });
  it('hidden after a big jump', () => {
    expect(m.estimateRemaining(run(30, (s: number) => (s < 20 ? 0.05 : 0.5 + (s - 20) * 0.01)))).toBeNull();
  });
  it('hidden when the rate is unstable (a crawl, then a burst)', () => {
    expect(m.estimateRemaining(run(30, (s: number) => (s < 15 ? s * 0.0005 : 0.0075 + (s - 15) * 0.02)))).toBeNull();
  });
  it('hidden when finished', () => { expect(m.estimateRemaining(run(30, (s: number) => (s === 30 ? 1 : s * 0.01)))).toBeNull(); });
  it('hidden with too few samples', () => { expect(m.estimateRemaining([{ t: 0, f: 0 }, { t: 20000, f: 0.2 }])).toBeNull(); });
});

describe.each(impls)('overallFraction (%s)', (_n, m) => {
  it('weights maps and apps as the long phase: quick phases done is about 15%, not 5 of 6', () => {
    const f = m.overallFraction(ids, { deps: { done: 0, total: 133 } }, 'deps');
    expect(f).toBeGreaterThan(0.1); expect(f).toBeLessThan(0.2);
    expect(m.overallFraction(ids, { deps: { done: 133, total: 133 } }, 'deps')).toBeCloseTo(1, 5);
  });
  it('slow phase ahead: the same steady pace in maps and apps gives minutes left, not seconds', () => {
    // 1 map or app a second out of 133, after the quick phases
    const e = m.estimateRemaining(run(20, (s: number) => m.overallFraction(ids, { deps: { done: s, total: 133 } }, 'deps')));
    expect(e.text).toBe('about 2 minutes left');
  });
  it('finished is 1; unknown totals count as 0', () => {
    expect(m.overallFraction(ids, {}, null, true)).toBe(1);
    expect(m.overallFraction(ids, { find: { done: 5, total: 0 } }, 'find')).toBe(0);
  });
});

describe.skipIf(!js)('app and prototype agree', () => {
  it('same weights and thresholds', () => {
    expect(ts.PHASE_WEIGHTS).toEqual(js.PHASE_WEIGHTS);
    for (const k of ['ESTIMATE_MIN_ELAPSED_MS', 'ESTIMATE_WINDOW_MS', 'ESTIMATE_MIN_SPAN_MS', 'ESTIMATE_MIN_PROGRESS', 'ESTIMATE_JUMP', 'ESTIMATE_STABLE_RATIO', 'ESTIMATE_MAX_MS'] as const)
      expect(ts[k]).toBe(js[k]);
  });
  it('same answers on a lumpy run', () => {
    const lumpy = run(40, (s: number) => 0.02 + s * 0.004 + (s % 5 === 0 ? 0.003 : 0));
    expect(ts.estimateRemaining(lumpy)).toEqual(js.estimateRemaining(lumpy));
  });
  it('createEstimator copes with a sample every frame (16 ms)', () => {
    const e = ts.createEstimator(0);
    for (let ms = 0; ms <= 20000; ms += 16) e.add(ms / 100000, ms);
    expect(e.estimate()?.text).toBe('about 1 minute left');
  });
  it('createEstimator collects samples', () => {
    const e = ts.createEstimator(1000);
    for (let s = 0; s <= 25; s++) e.add(s * 0.01, 1000 + s * 1000);
    expect(e.estimate()?.text).toBe('about 1 minute left');
  });
});

describe('Rescan estimate (DC-105)', () => {
  it('uses the last full scan, scaled to the services there are now', () => {
    expect(ts.rescanEstimate(7000, { ms: 1_500_000, items: 7000 })).toEqual({ ms: 1_500_000, measured: true });
    expect(ts.rescanEstimate(3500, { ms: 1_500_000, items: 7000 })).toEqual({ ms: 750_000, measured: true });
  });
  it('falls back to the per-service rate when no full scan is on record, or it is unusable', () => {
    expect(ts.rescanEstimate(7000)).toEqual({ ms: 7000 * ts.RESCAN_FALLBACK_MS_PER_ITEM, measured: false });
    expect(ts.rescanEstimate(200, null).measured).toBe(false);
    expect(ts.rescanEstimate(200, { ms: 0, items: 100 }).measured).toBe(false);
    expect(ts.rescanEstimate(200, { ms: 5000, items: 0 }).measured).toBe(false);
  });
  it('asks only for a big org: 200 services is under two minutes, 7,000 is well over', () => {
    expect(ts.rescanEstimate(200).ms).toBeLessThan(ts.RESCAN_ASK_MS);
    expect(ts.rescanEstimate(7000).ms).toBeGreaterThan(ts.RESCAN_ASK_MS);
  });
  const min = (n: number) => n * 60000;
  it('rounds to a friendly figure', () => {
    expect(ts.sayDuration(min(1))).toBe('a minute');
    expect(ts.sayDuration(min(3.4))).toBe('3 minutes');
    expect(ts.sayDuration(min(9.6))).toBe('10 minutes');
    expect(ts.sayDuration(min(12))).toBe('10 minutes');
    expect(ts.sayDuration(min(23))).toBe('25 minutes');
    expect(ts.sayDuration(min(50))).toBe('50 minutes');
    expect(ts.sayDuration(min(58))).toBe('an hour');
    expect(ts.sayDuration(min(66))).toBe('an hour');
    expect(ts.sayDuration(min(90))).toBe('an hour and a half');
    expect(ts.sayDuration(min(120))).toBe('2 hours');
    expect(ts.sayDuration(min(150))).toBe('2 and a half hours');
  });
  it('says roughly when it is not from a real scan', () => {
    expect(ts.sayRescan({ ms: min(25), measured: true })).toBe('about 25 minutes, based on your last full scan');
    expect(ts.sayRescan({ ms: min(58), measured: false })).toBe('roughly an hour, going by how many services there are');
  });
});
