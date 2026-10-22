// DC-071a: the three-stage progress model.
import { describe, expect, it } from 'vitest';
import { ScanMeter, STAGE_LABELS } from './progress';
import type { ScanStages } from './types';

function meter(emitMs = 250) {
  let t = 0;
  const out: ScanStages[] = [];
  const m = new ScanMeter({ clock: () => t, emit: (s) => out.push(s), emitMs, limiter: { state: () => ({ limit: 8, inFlight: 5, queued: 40, completed: 0, throttles: 1, paused: false, slowedDown: true }) } });
  return { m, out, at: (ms: number) => { t = ms; } };
}
const stage = (s: ScanStages, id: string) => s.stages.find((x) => x.id === id)!;

describe('ScanMeter', () => {
  it('three stages with plain labels; find and measure start at once, maps and apps wait', () => {
    const { m } = meter();
    const s = m.snapshot();
    expect(s.stages.map((x) => [x.id, x.label, x.state])).toEqual([
      ['find', 'Finding layers', 'working'], ['measure', 'Checking use and size', 'working'], ['deps', 'Checking maps and apps', 'waiting'],
    ]);
    expect(STAGE_LABELS.deps).toBe('Checking maps and apps');
    expect(s).toMatchObject({ current: 'find', percent: 0, readyToReview: false, finished: false, stopped: false });
  });

  it('headline counts per stage, with parts, and the stage is done only when all its parts are', () => {
    const { m } = meter();
    m.set('services', 7000, 7000);
    expect(stage(m.snapshot(), 'find').state).toBe('working'); // owners not in yet
    m.set('owners', 400, 400);
    let s = m.snapshot();
    expect(stage(s, 'find')).toMatchObject({ state: 'done', done: 7000, total: 7000, fraction: 1, parts: { services: { done: 7000, total: 7000 }, owners: { done: 400, total: 400 } } });
    expect(s.current).toBe('measure');
    m.set('usage', 3, 3); m.set('views', 10, 1400); m.set('sizes', 0, 7000);
    s = m.snapshot();
    expect(stage(s, 'measure')).toMatchObject({ state: 'working', done: 0, total: 7000 });
    expect(stage(s, 'measure').fraction).toBeGreaterThan(0.2);
    m.set('views', 1400, 1400); m.set('sizes', 7000, 7000);
    expect(stage(m.snapshot(), 'measure').state).toBe('done');
    m.set('listing', 3000, 3000); m.set('maps', 0, 3000); m.begin('deps');
    s = m.snapshot();
    expect(stage(s, 'deps')).toMatchObject({ state: 'working', done: 0, total: 3000 });
    expect(s.current).toBe('deps');
  });

  it('rates are items per second over the recent window, and the estimate comes from calls', () => {
    const { m, at } = meter();
    m.set('services', 7000, 7000); m.set('owners', 1, 1); m.set('usage', 3, 3); m.set('views', 0, 0); m.set('sizes', 0, 0);
    m.set('listing', 3000, 3000);
    at(1000); m.set('maps', 0, 3000); m.begin('deps');
    for (let k = 1; k <= 100; k++) { at(1000 + k * 50); m.call(); m.set('maps', k, 3000); }
    const s = m.snapshot();
    expect(stage(s, 'deps').rate).toBeCloseTo(20, 0); // 100 maps in 5 s
    expect(s.estimate.callsPerSec).toBeCloseTo(20, 0);
    expect(s.estimate.callsLeft).toBe(2900);
    expect(s.estimate.etaMs).toBeCloseTo(145_000, -3);
    expect(s.estimate).toMatchObject({ limit: 8, inFlight: 5, queued: 40, slowedDown: true, throttles: 1 });
    expect(s.percent).toBe(Math.floor((100 * 100) / 3000));
  });

  it('planned calls replace the per-item guess (hybrid sizing lists owners, not items)', () => {
    const { m } = meter();
    m.set('services', 100, 100); m.set('owners', 1, 1); m.set('usage', 3, 3); m.set('views', 0, 0); m.skipDeps();
    m.set('sizes', 0, 7000);
    expect(m.snapshot().estimate.callsLeft).toBe(7000);
    m.plan('sizes', 450);
    expect(m.snapshot().estimate.callsLeft).toBe(450);
  });

  it('percent stays below 100 until finished; a stop marks unfinished stages stopped', () => {
    const { m } = meter();
    m.set('services', 10, 10); m.set('owners', 1, 1); m.set('usage', 3, 3); m.set('views', 0, 0); m.set('sizes', 10, 10);
    m.set('listing', 50, 50); m.set('maps', 50, 50);
    for (let k = 0; k < 20; k++) m.call();
    expect(m.snapshot().percent).toBe(99);
    m.finish(false);
    expect(m.snapshot()).toMatchObject({ percent: 100, finished: true, current: null });

    const b = meter().m;
    b.set('services', 10, 10); b.set('owners', 1, 1); b.set('maps', 5, 50); b.core(); b.finish(true);
    const s = b.snapshot();
    expect(s).toMatchObject({ stopped: true, finished: false, readyToReview: true, current: null });
    expect(s.stages.map((x) => x.state)).toEqual(['done', 'stopped', 'stopped']);
    expect(s.percent).toBeLessThan(100);
  });

  it('a stopped scan keeps the share of work done, not 99', () => {
    const { m } = meter();
    m.set('services', 10, 10); m.set('owners', 1, 1); m.set('usage', 3, 3); m.set('views', 0, 0); m.set('sizes', 50, 100);
    m.skipDeps();
    for (let k = 0; k < 50; k++) m.call();
    m.core();
    const before = m.snapshot().percent;
    m.finish(true);
    const s = m.snapshot();
    expect(s.stopped).toBe(true);
    expect(s.percent).toBe(before);
    expect(s.percent).toBeGreaterThan(40);
    expect(s.percent).toBeLessThan(60);
  });

  it('emits on stage changes straight away and otherwise at most every 250 ms', () => {
    const { m, out, at } = meter();
    const n0 = out.length;
    for (let k = 1; k <= 10; k++) { at(k * 10); m.set('services', k * 100, 7000); }
    expect(out.length - n0).toBeLessThanOrEqual(1);
    at(400); m.set('services', 7000, 7000); m.set('owners', 3, 3); // find is done: a state change
    expect(stage(out.at(-1)!, 'find').state).toBe('done');
    const before = out.length;
    m.core();
    expect(out.length).toBe(before + 1);
    expect(out.at(-1)!.readyToReview).toBe(true);
  });
});
