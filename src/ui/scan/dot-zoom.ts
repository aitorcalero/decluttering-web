// Review's chart zoom: a window onto the plot's own fractions (0..1 across and up). Pure: tested without a canvas.
import type { DragRect } from './dot-select';
import { normalise } from './dot-select';

/** The part of the plot on screen, in plot fractions (x right, y up). The whole plot is { 0, 1, 0, 1 }. */
export interface View { x0: number; x1: number; y0: number; y1: number }
export const FULL: View = { x0: 0, x1: 1, y0: 0, y1: 1 };
/** Narrowest view on either axis: about 50 times the whole plot. */
export const MIN_SPAN = 0.02;
/** A little past the edges, so the dots that sit on them can be framed too. */
const EDGE = 0.05;

export const isFull = (v: View): boolean => v.x0 <= 0 && v.x1 >= 1 && v.y0 <= 0 && v.y1 >= 1;

/** The drawing area in px: where fraction 0 and 1 land (the plot less its inner margin). */
export interface Area { gx: number; gy: number; gw: number; gh: number }

/** Plot fraction to px, through a view. */
export const toPx = (a: Area, v: View, nx: number, ny: number): [number, number] =>
  [a.gx + (nx - v.x0) / (v.x1 - v.x0) * a.gw, a.gy + (1 - (ny - v.y0) / (v.y1 - v.y0)) * a.gh];

/** px to plot fraction, through a view. */
export const toFraction = (a: Area, v: View, px: number, py: number): [number, number] =>
  [v.x0 + (px - a.gx) / a.gw * (v.x1 - v.x0), v.y0 + (1 - (py - a.gy) / a.gh) * (v.y1 - v.y0)];

function fit(lo: number, hi: number): [number, number] {
  lo = Math.max(-EDGE, lo); hi = Math.min(1 + EDGE, hi);
  if (hi - lo >= MIN_SPAN) return [lo, hi];
  const mid = Math.min(1 + EDGE - MIN_SPAN / 2, Math.max(-EDGE + MIN_SPAN / 2, (lo + hi) / 2));
  return [mid - MIN_SPAN / 2, mid + MIN_SPAN / 2];
}

/** The view a rectangle drawn in px (on the current view) asks for, kept within the plot and no narrower than MIN_SPAN. */
export function viewFromRect(a: Area, v: View, rect: DragRect): View {
  const r = normalise(rect);
  const [fx0, fy1] = toFraction(a, v, r.x0, r.y0), [fx1, fy0] = toFraction(a, v, r.x1, r.y1);
  const [x0, x1] = fit(fx0, fx1), [y0, y1] = fit(fy0, fy1);
  return { x0, x1, y0, y1 };
}

/** The view part way from `a` to `b` (k from 0 to 1). */
export const lerpView = (a: View, b: View, k: number): View =>
  ({ x0: a.x0 + (b.x0 - a.x0) * k, x1: a.x1 + (b.x1 - a.x1) * k, y0: a.y0 + (b.y0 - a.y0) * k, y1: a.y1 + (b.y1 - a.y1) * k });

/** True when a point (plot fractions) is in the view. */
export const inView = (v: View, nx: number, ny: number): boolean => nx >= v.x0 && nx <= v.x1 && ny >= v.y0 && ny <= v.y1;

/**
 * Axis ticks for a zoomed view: from `candidates` (days, placed by `place`), those inside [lo, hi] and at least `gap` px apart
 * on an axis `span` px long. The ends of the list win over the middle when they crowd.
 */
export function ticksIn(candidates: readonly number[], place: (d: number) => number, lo: number, hi: number, span: number, gap: number): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (const d of candidates) {
    const f = place(d);
    if (f < lo || f > hi) continue;
    const px = (f - lo) / (hi - lo) * span;
    if (px - last < gap) continue;
    out.push(d); last = px;
  }
  return out;
}

/** What a tick at `days` reads as: today, days, weeks, months or years (half years when not whole). */
export type DayUnit = { unit: 'today' | 'days' | 'weeks' | 'months' | 'years'; n: number };
export function dayUnit(days: number): DayUnit {
  if (days <= 0) return { unit: 'today', n: 0 };
  if (days < 14) return { unit: 'days', n: Math.round(days) };
  if (days < 60) return { unit: 'weeks', n: Math.round(days / 7) };
  if (days < 365) return { unit: 'months', n: Math.round(days / 30.44) };
  return { unit: 'years', n: Math.round(days / 365 * 2) / 2 };
}
