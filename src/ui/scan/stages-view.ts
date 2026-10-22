// DC-071b: what the scan screen says about progress, from the three-stage model (ScanStages, DC-071a). Pure; no DOM.
// One current-stage line with a live count, one overall percent, a smoothed estimate, a quiet "how we're crawling" line,
// the stage list, the tab title, and when the big-org card shows. Only stage changes and completion are announced.
import type { ScanEstimate, ScanStages, StageId, StageProgress, StageState } from '../../scan/types';
import { sayRemaining } from './estimate';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-AU');
const plural = (n: number, a: string, b: string) => `${fmt(n)} ${n === 1 ? a : b}`;

export const ALL_DONE = 'All done. Take a look around the map, or move on to the review.';
export const STOPPED_LINE = 'Stopped. Next time we pick up where we left off.';
export const APP_TITLE = 'Decluttering';

/** "1,240 of 3,050", "2,300 so far", or '' when nothing is counted yet. */
export function stageCount(s: Pick<StageProgress, 'done' | 'total'>): string {
  if (s.total === null) return s.done > 0 ? `${fmt(s.done)} so far` : '';
  return `${fmt(Math.min(s.done, s.total))} of ${fmt(s.total)}`;
}

const stageOf = (st: ScanStages, id: StageId): StageProgress => st.stages.find((s) => s.id === id) as StageProgress;

/** The one line above the bar: "Checking maps and apps: 1,240 of 3,050". */
export function currentLine(st: ScanStages | null): string {
  if (!st) return 'Getting started…';
  if (st.finished) return ALL_DONE;
  if (st.stopped) return STOPPED_LINE;
  if (!st.current) return 'Finishing up…';
  const s = stageOf(st, st.current);
  // Sizes (the headline) often start after use and views: say what is moving instead of a count stuck at 0.
  if (s.id === 'measure' && s.done === 0) {
    const { usage, views } = s.parts;
    const layers = stageOf(st, 'find').total;
    const of = layers ? ` for ${plural(layers, 'layer', 'layers')}` : '';
    if (usage && (usage.total === null || usage.done < usage.total)) return `${s.label}: reading use${of}…`;
    if (views && views.total !== null && views.done < views.total) return `${s.label}: matching views to their layers…`;
  }
  const c = stageCount(s);
  return c ? `${s.label}: ${c}` : `${s.label}…`;
}

/** Services the search said there are (the dot map lays its grid out for them, so dots fill in without shifting). */
export function servicesExpected(st: ScanStages | null): number {
  return st ? stageOf(st, 'find').total ?? 0 : 0;
}

/** The announced line (role=status): the stage in plain words, never the counts, so it only changes with the stage. */
export function announceLine(st: ScanStages | null): string {
  if (!st) return 'Getting started.';
  if (st.finished) return ALL_DONE;
  if (st.stopped) return STOPPED_LINE;
  const label = st.current ? `${stageOf(st, st.current).label}.` : 'Finishing up.';
  return st.readyToReview ? `Ready to review. ${label}` : label;
}

export interface StageRow { id: StageId; label: string; state: StageState; count: string; detail: string; fraction: number }

/** "What we're up to": the three stages, each with its state, its count and a short line about its parts. */
export function stageRows(st: ScanStages | null, mode = 'admin'): StageRow[] {
  if (!st) return [];
  return st.stages.map((s) => {
    const p = s.parts;
    let detail = '';
    if (s.state === 'waiting') detail = 'Waiting its turn';
    else if (s.id === 'find') {
      const owners = p.owners;
      detail = mode === 'my-items' ? (s.state === 'done' ? 'All matched to your account' : 'Matching them to your account')
        : owners && owners.total !== null && owners.total > 0 ? (owners.done >= owners.total ? plural(owners.total, 'owner', 'owners') : `owners ${fmt(owners.done)} of ${fmt(owners.total)}`) : '';
    } else if (s.id === 'measure') {
      const usage = p.usage, views = p.views;
      const bits = [
        usage && usage.total !== null ? (usage.done >= usage.total ? 'use in' : 'reading use') : null,
        views && views.total !== null && views.total > 0 && views.done < views.total ? 'matching views' : null,
      ].filter(Boolean);
      detail = bits.join(' · ');
    } else if (s.id === 'deps') {
      detail = s.state === 'done' && s.total === 0 ? 'No maps or apps to check' : s.total === null ? 'Listing maps and apps' : '';
    }
    if (s.state === 'stopped') detail = 'Stopped here; next time we carry on';
    return { id: s.id, label: s.label, state: s.state, count: stageCount(s), detail, fraction: s.fraction };
  });
}

/** The tab title: "42% · Decluttering" while it runs, "Done · Decluttering" at the end. */
export function tabTitle(st: ScanStages | null, base = APP_TITLE): string {
  if (!st) return base;
  if (st.finished) return `Done · ${base}`;
  if (st.stopped) return `Stopped · ${base}`;
  return `${st.percent}% · ${base}`;
}

/** FB-23: a calm line that shows the scan is smart (several requests at once), never an error. */
export function crawlLine(e: Pick<ScanEstimate, 'limit' | 'slowedDown'> | null | undefined): string | null {
  if (!e || e.limit <= 0) return null;
  if (e.slowedDown) return 'Going gently: ArcGIS Online asked us to slow down';
  return `${e.limit} requests at a time · steady`;
}

/** The big-org card appears after this much time, if the scan still has a while to go. */
export const BIG_ORG_AFTER_MS = 15_000;
/** ...and if at least this much is left (or the estimate isn't known yet). */
export const BIG_ORG_MIN_LEFT_MS = 60_000;

export function wantsBigOrgCard(st: ScanStages | null, eta: { ms: number } | null): boolean {
  if (!st || st.finished || st.stopped || st.elapsedMs < BIG_ORG_AFTER_MS) return false;
  const left = eta?.ms ?? st.estimate.etaMs;
  return left === null || left >= BIG_ORG_MIN_LEFT_MS;
}

/** FB-77: the "While you wait" tips appear after this much time... */
export const TIPS_AFTER_MS = 10_000;
/** ...if the whole scan (elapsed plus time left; unknown counts as long) is at least this long. */
export const TIPS_MIN_TOTAL_MS = 60_000;

export function wantsTips(st: ScanStages | null, eta: { ms: number } | null): boolean {
  if (!st || st.finished || st.stopped || st.elapsedMs < TIPS_AFTER_MS) return false;
  const left = eta?.ms ?? st.estimate.etaMs;
  return left === null || st.elapsedMs + left >= TIPS_MIN_TOTAL_MS;
}

/** Maps and apps still to look inside, for the card ("3,050 maps and apps to look inside"); null while not known. */
export function mapsToCheck(st: ScanStages | null): number | null {
  if (!st) return null;
  const d = stageOf(st, 'deps');
  return d.total;
}

/** Usage is in: the dot map's lenses mean something now. */
export function usageIn(st: ScanStages | null): boolean {
  if (!st) return true;
  const u = stageOf(st, 'measure').parts.usage;
  return !!u && u.total !== null && u.done >= u.total;
}

/*
 * The estimate. The meter gives calls left / calls per second over the last ~10 s, which jumps around as stages change.
 * Shown only once it is stable: after ESTIMATE_AFTER_MS, smoothed, and only after a few readings agree. Once shown, it
 * counts down with real time between readings, so a steady scan never shows the number going up by a little.
 */
export const ESTIMATE_AFTER_MS = 15_000;
const SMOOTH = 0.25;
const AGREE = 3;
const AGREE_RATIO = 2;
const MAX_MS = 6 * 60 * 60 * 1000;
export const SLACK = 1.2;

export function createEtaSmoother() {
  let smoothed: number | null = null;
  let lastT = 0;
  let agree = 0;
  let shown = false;
  return {
    /** Feed every ScanStages; returns the estimate to show, or null. */
    add(st: ScanStages): { ms: number; text: string } | null {
      const raw = st.estimate.etaMs, t = st.elapsedMs;
      if (st.finished || st.stopped) { smoothed = null; shown = false; agree = 0; return null; }
      if (raw === null || !Number.isFinite(raw) || raw > MAX_MS) { agree = 0; lastT = t; return shown && smoothed !== null ? out(smoothed) : null; }
      const dt = Math.max(0, t - lastT); lastT = t;
      if (smoothed === null) smoothed = raw;
      else {
        const aged = Math.max(0, smoothed - dt);
        smoothed = aged + SMOOTH * (raw - aged);
      }
      const close = Math.max(raw, smoothed) / Math.max(1, Math.min(raw, smoothed)) <= AGREE_RATIO;
      agree = close ? agree + 1 : 0;
      if (!shown && t >= ESTIMATE_AFTER_MS && agree >= AGREE) shown = true;
      return shown ? out(smoothed) : null;
    },
  };
  // Words carry some slack (NN/g: allow extra time), so "under a minute" is never said with a minute still to go.
  function out(ms: number) { return { ms, text: sayRemaining(ms * SLACK) }; }
}
