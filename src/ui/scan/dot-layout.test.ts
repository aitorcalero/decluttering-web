import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../domain/stale';
import { DENSITY_ABOVE, GROW_ABOVE, densityAlpha, densityBins, mapHeight, zoneBox } from './dot-layout';

describe('dot map at scale (DC-071b, FB-18)', () => {
  it('keeps today’s height up to the threshold', () => {
    expect(mapHeight(700, 50, 900)).toBe(406);
    expect(mapHeight(700, GROW_ABOVE, 900)).toBe(406);
    expect(mapHeight(400, 500, 800)).toBe(300);
  });

  it('grows with the square root of the count, capped at 70% of the viewport', () => {
    const h3k = mapHeight(800, 3000, 1000);
    expect(h3k).toBeGreaterThan(mapHeight(800, 1000, 1000));
    expect(h3k).toBeLessThanOrEqual(700);
    expect(mapHeight(800, 7000, 1000)).toBe(700);
    // A short viewport never shrinks it below the base.
    expect(mapHeight(800, 7000, 300)).toBe(460);
    // Phone: grows, within the cap.
    expect(mapHeight(358, 7000, 844)).toBe(591);
  });

  it('bins points per cell and shades log-scaled', () => {
    const bins = densityBins([[1, 1], [2, 3], [9, 1], [11, 11]], 8);
    expect(bins.get('0,0')).toBe(2);
    expect(bins.get('1,0')).toBe(1);
    expect(bins.get('1,1')).toBe(1);
    expect(densityAlpha(0, 10)).toBe(0);
    expect(densityAlpha(1, 10)).toBeGreaterThan(0.12);
    expect(densityAlpha(10, 10)).toBeCloseTo(0.62);
    expect(DENSITY_ABOVE).toBe(3000);
  });
});

import {
  ENTER_MS, STAGGER_MAX_MS, TRAVEL_MS, entryLook, heightTween, motionAt, pendingRadius, prePoint, progress, retarget,
  sizeBand, staggerDelay, tweenAt, xUpdate,
} from './dot-layout';

describe('dot map motion (DC-082, FB-33)', () => {
  it('progress eases 0..1 over the duration, and a zero duration is already there', () => {
    expect(progress(100, 100, 400)).toBe(0);
    expect(progress(300, 100, 400)).toBeCloseTo(0.5);
    expect(progress(900, 100, 400)).toBe(1);
    expect(progress(50, 100, 400)).toBe(0); // not started yet (a staggered dot)
    expect(progress(100, 100, 0)).toBe(1);
  });

  it('staggers a batch by a few ms each, capped so 7,000 dots do not take forever', () => {
    expect(staggerDelay(0, 1)).toBe(0);
    expect(staggerDelay(0, 50)).toBe(0);
    expect(staggerDelay(49, 50)).toBeGreaterThan(0);
    expect(staggerDelay(49, 50)).toBeLessThan(STAGGER_MAX_MS);
    expect(staggerDelay(6999, 7000)).toBeCloseTo(STAGGER_MAX_MS);
    expect(staggerDelay(3500, 7000)).toBeLessThan(STAGGER_MAX_MS);
    // later in the batch, later in time
    expect(staggerDelay(20, 50)).toBeGreaterThan(staggerDelay(10, 50));
  });

  it('a new dot fades and grows in from nothing, with a small overshoot, and settles at full size', () => {
    expect(entryLook(0, false)).toEqual({ alpha: 0, scale: 0 });
    const mid = entryLook(0.7, false);
    expect(mid.alpha).toBeGreaterThan(0.5);
    expect(mid.scale).toBeGreaterThan(1); // a little pop
    expect(mid.scale).toBeLessThan(1.2);
    expect(entryLook(1, false)).toEqual({ alpha: 1, scale: 1 });
    // reduced motion: a fade only, never a grow
    expect(entryLook(0.3, true).scale).toBe(1);
    expect(entryLook(0.3, true).alpha).toBeCloseTo(0.3);
    expect(ENTER_MS).toBeLessThanOrEqual(600);
  });

  it('a motion travels from its start to its target, and holds before a staggered start', () => {
    const m = retarget(null, 0, [0.5, 0.5, 3], 0, 0); // first placement: already there
    expect(motionAt(m, 0)).toEqual([0.5, 0.5, 3]);
    const go = retarget(m, 1000, [1, 0, 5], 100, TRAVEL_MS);
    expect(motionAt(go, 1000)).toEqual([0.5, 0.5, 3]); // waiting for its turn
    expect(motionAt(go, 1100)).toEqual([0.5, 0.5, 3]);
    const half = motionAt(go, 1100 + TRAVEL_MS / 2);
    expect(half[0]).toBeCloseTo(0.75); expect(half[1]).toBeCloseTo(0.25); expect(half[2]).toBeCloseTo(4);
    expect(motionAt(go, 1100 + TRAVEL_MS)).toEqual([1, 0, 5]);
  });

  it('retargeting mid-flight starts from where the dot is drawn, so it never jumps', () => {
    const a = retarget(retarget(null, 0, [0, 0, 2], 0, 0), 0, [1, 0, 2], 0, 1000);
    const now = 500, here = motionAt(a, now);
    const b = retarget(a, now, [1, 1, 2], 0, 1000);
    expect(motionAt(b, now)).toEqual(here);
    // the same target again keeps the running motion (sizes land in many small batches)
    expect(retarget(b, 700, [1, 1, 2], 0, 1000)).toBe(b);
  });

  it('reduced motion: a zero duration moves at once, no travel', () => {
    const a = retarget(retarget(null, 0, [0, 0, 2], 0, 0), 10, [1, 1, 4], 0, 0);
    expect(motionAt(a, 10)).toEqual([1, 1, 4]);
  });

  it('height eases from where it is drawn to the new height', () => {
    const t = heightTween(null, 0, 600, 0);
    expect(tweenAt(t, 0)).toBe(600);
    const down = heightTween(t, 100, 434, 600);
    expect(tweenAt(down, 100)).toBe(600);
    expect(tweenAt(down, 400)).toBeCloseTo(517, 0);
    expect(tweenAt(down, 700)).toBe(434);
    const back = heightTween(down, 400, 600, 600); // interrupted: from the drawn height
    expect(tweenAt(back, 400)).toBeCloseTo(517, 0);
    expect(heightTween(back, 450, 600, 600)).toBe(back); // same target: unchanged
  });

  it('before usage is in, a dot already sits at its last-updated place across', () => {
    const [x, y] = prePoint(400, 7);
    expect(x).toBeCloseTo(xUpdate(400, 7));
    expect(y).toBeGreaterThan(0.08); expect(y).toBeLessThan(0.86);
    expect(prePoint(400, 7)).toEqual([x, y]); // stable
  });

  it('unmeasured dots shrink as the count grows, within limits', () => {
    expect(pendingRadius(100)).toBeCloseTo(2.6);
    expect(pendingRadius(7000)).toBeLessThan(pendingRadius(2000));
    expect(pendingRadius(20000)).toBeGreaterThanOrEqual(1.4);
  });

  it('FB-30: the left column on "How big" says what is in it', () => {
    const d = (sized: boolean, sizeMB: number) => ({ sized, sizeMB });
    expect(sizeBand([d(true, 40)])).toEqual({ label: 'no storage', note: '' });
    expect(sizeBand([d(true, 0), d(true, 0.05), d(true, 40)])).toEqual({ label: 'no storage', note: '2 with no storage' });
    expect(sizeBand([d(false, 0), d(false, 0), d(true, 40)])).toEqual({ label: 'not measured yet', note: '2 not measured yet' });
    expect(sizeBand([d(false, 0), d(true, 0), d(true, 40)])).toEqual({ label: 'none or not measured', note: '1 not measured yet, 1 with no storage' });
    expect(sizeBand([d(false, 0), ...Array.from({ length: 1600 }, () => d(false, 0))]).note).toBe('1,601 not measured yet');
  });
});

import { seedOf } from './dot-layout';
describe('stable jitter seed (DC-082)', () => {
  it('is the same for the same id and differs between ids, so a dot keeps its place when others leave', () => {
    expect(seedOf('abc123')).toBe(seedOf('abc123'));
    expect(seedOf('abc123')).not.toBe(seedOf('abc124'));
    expect(Number.isInteger(seedOf('x'))).toBe(true);
  });
});

describe('the stale zone box (DC-106, FB-63)', () => {
  const INSET = 16;
  const rules = [['gentle', PRESETS.gentle], ['balanced', PRESETS.balanced], ['strict', PRESETS.strict],
    ['custom 2 years', { ...PRESETS.balanced, minDaysSinceUpdate: 730, minDaysSinceUse: 730 }],
    ['custom 3 years+', { ...PRESETS.balanced, minDaysSinceUpdate: 1500, minDaysSinceUse: 1500 }]] as const;
  for (const w of [300, 700, 1200]) {
    const plot = { x0: 70, y0: 12, w: w - 70 - 14, h: 300 };
    for (const [name, t] of rules) {
      it(`${name}: the left edge is inside the drawable area (plot ${w} px wide)`, () => {
        const b = zoneBox(plot, INSET, t);
        expect(b.left).toBeGreaterThan(plot.x0);
        expect(b.left).toBeLessThan(b.right);
        expect(b.right).toBeLessThanOrEqual(plot.x0 + plot.w);
        expect(b.top).toBeGreaterThan(plot.y0);
        expect(b.bottom).toBeGreaterThan(b.top);
        expect(b.bottom).toBeLessThanOrEqual(plot.y0 + plot.h);
        expect(b.left % 1).toBe(0.5); // a crisp 1 px line
      });
    }
  }

  it('Gentle and Suggested put the left edge exactly on the "1 year" grid line, so the border must be painted after the grid', () => {
    expect(xUpdate(PRESETS.gentle.minDaysSinceUpdate, 0)).toBe(xUpdate(365, 0));
  });
});
