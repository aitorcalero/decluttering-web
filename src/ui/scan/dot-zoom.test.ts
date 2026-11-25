import { describe, expect, it } from 'vitest';
import { FULL, MIN_SPAN, dayUnit, inView, isFull, lerpView, ticksIn, toFraction, toPx, viewFromRect } from './dot-zoom';

const area = { gx: 100, gy: 20, gw: 800, gh: 400 };

describe('chart zoom', () => {
  it('px and fractions round-trip through any view', () => {
    const v = { x0: 0.2, x1: 0.6, y0: 0.1, y1: 0.5 };
    const [px, py] = toPx(area, v, 0.3, 0.25);
    const [fx, fy] = toFraction(area, v, px, py);
    expect(fx).toBeCloseTo(0.3); expect(fy).toBeCloseTo(0.25);
    expect(toPx(area, FULL, 0, 0)).toEqual([100, 420]); // bottom left
    expect(toPx(area, FULL, 1, 1)).toEqual([900, 20]); // top right
  });
  it('a rectangle on the whole plot becomes that part of it, whichever way it was drawn', () => {
    const v = viewFromRect(area, FULL, { x0: 500, y0: 420, x1: 100, y1: 220 }); // left half, bottom half
    expect(v.x0).toBeCloseTo(0); expect(v.x1).toBeCloseTo(0.5);
    expect(v.y0).toBeCloseTo(0); expect(v.y1).toBeCloseTo(0.5);
  });
  it('zooms again inside a zoomed view', () => {
    const v1 = { x0: 0.5, x1: 1, y0: 0.5, y1: 1 };
    const v2 = viewFromRect(area, v1, { x0: 100, y0: 20, x1: 500, y1: 220 }); // its top-left quarter
    expect(v2.x0).toBeCloseTo(0.5); expect(v2.x1).toBeCloseTo(0.75);
    expect(v2.y0).toBeCloseTo(0.75); expect(v2.y1).toBeCloseTo(1);
  });
  it('never narrower than the minimum, nor far past the plot', () => {
    const tiny = viewFromRect(area, FULL, { x0: 500, y0: 200, x1: 501, y1: 201 });
    expect(tiny.x1 - tiny.x0).toBeCloseTo(MIN_SPAN); expect(tiny.y1 - tiny.y0).toBeCloseTo(MIN_SPAN);
    const wide = viewFromRect(area, FULL, { x0: -500, y0: -500, x1: 2000, y1: 2000 });
    expect(wide.x0).toBeGreaterThanOrEqual(-0.05); expect(wide.x1).toBeLessThanOrEqual(1.05);
    expect(isFull(wide)).toBe(true);
  });
  it('tweens, and knows what is inside', () => {
    expect(lerpView(FULL, { x0: 0.5, x1: 1, y0: 0, y1: 0.5 }, 0.5)).toEqual({ x0: 0.25, x1: 1, y0: 0, y1: 0.75 });
    expect(inView({ x0: 0.2, x1: 0.4, y0: 0, y1: 1 }, 0.3, 0.5)).toBe(true);
    expect(inView({ x0: 0.2, x1: 0.4, y0: 0, y1: 1 }, 0.5, 0.5)).toBe(false);
  });
  it('picks ticks inside the view, spaced out', () => {
    const place = (d: number) => d / 100;
    expect(ticksIn([0, 10, 20, 30, 40, 50, 60], place, 0.2, 0.6, 400, 90)).toEqual([20, 30, 40, 50, 60]);
    expect(ticksIn([0, 10, 20, 30, 40, 50, 60], place, 0.2, 0.6, 400, 150)).toEqual([20, 40, 60]);
    expect(ticksIn([0, 10], place, 0.5, 0.6, 400, 10)).toEqual([]);
  });
  it('labels a number of days in the unit that reads best', () => {
    expect(dayUnit(0)).toEqual({ unit: 'today', n: 0 });
    expect(dayUnit(3)).toEqual({ unit: 'days', n: 3 });
    expect(dayUnit(14)).toEqual({ unit: 'weeks', n: 2 });
    expect(dayUnit(90)).toEqual({ unit: 'months', n: 3 });
    expect(dayUnit(545)).toEqual({ unit: 'years', n: 1.5 });
    expect(dayUnit(730)).toEqual({ unit: 'years', n: 2 });
  });
});
