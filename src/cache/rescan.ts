// DC-105 (FB-62): when Review offers "Rescan". Pure, with the clock passed in.
const DAY_MS = 86_400_000;

/** Results this old (or older) are worth a fresh read. */
export const RESCAN_MIN_AGE_DAYS = 1;

export interface RescanState {
  /** A scan is running now (including the background refresh of a cached visit). */
  running: boolean;
  /** The last scan was stopped early: Resume is offered instead. */
  stopped: boolean;
  demo: boolean;
  /** Dev only: the simulated org, which has no cache age to go by. */
  simulated?: boolean;
  /**
   * When everything was last read in full (ISO), else when the results were saved. A cached visit's quiet refresh re-reads only
   * what changed, so it doesn't reset this clock; otherwise Rescan would hardly ever show.
   */
  savedAt?: string;
  /** The background refresh failed, so the results may be out of date whatever their age. */
  refreshFailed?: boolean;
  now: Date;
}

/** The clock Rescan goes by: the last full read if one is recorded, else when the results were saved. */
export const rescanClock = (entry: { fullScan?: { at?: string } } | null | undefined, savedAt: string): string | undefined =>
  entry?.fullScan?.at || savedAt || undefined;

export function canRescan(s: RescanState): boolean {
  if (s.running || s.stopped || s.demo) return false;
  if (s.simulated || s.refreshFailed) return true;
  if (!s.savedAt) return false;
  const age = s.now.getTime() - new Date(s.savedAt).getTime();
  return Number.isFinite(age) && age >= RESCAN_MIN_AGE_DAYS * DAY_MS;
}
