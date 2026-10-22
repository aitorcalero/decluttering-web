// DC-113 (FB-69): when the Review tour shows by itself. Pure rules; the browser bits are passed in so they can be tested.

/** The one localStorage key (app prefix, so /reset.html and sign-out clear it). 'seen' = shown once or skipped; 'never' = "Don't show again". */
export const TOUR_KEY = 'decluttering:tour-review';

export type TourMark = 'seen' | 'never';
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

const browserStorage = (): StorageLike | null => { try { return localStorage; } catch { return null; } };

/** What was stored, or null (nothing yet, or storage is blocked). */
export function readMark(storage: StorageLike | null = browserStorage()): TourMark | null {
  try {
    const v = storage?.getItem(TOUR_KEY);
    return v === 'seen' || v === 'never' ? v : null;
  } catch { return null; }
}

/** Remembers the choice. A blocked or full store is ignored: the in-memory session flag still stops a second showing. */
export function writeMark(mark: TourMark, storage: StorageLike | null = browserStorage()): void {
  try { storage?.setItem(TOUR_KEY, mark); } catch { /* storage blocked: shown at most once per page load instead */ }
}

/** Remembers that the tour was shown, without undoing an earlier "Don't show again" (a reopened tour must not bring it back). */
export function markSeen(storage: StorageLike | null = browserStorage()): void {
  if (readMark(storage) !== 'never') writeMark('seen', storage);
}

export interface ShowContext {
  /** The quick demo (`?fast=1` / `__DC_DEMO_FAST__`): the e2e specs must never see the tour. */
  fast: boolean;
  /** The review is "My items" (no chart of owners, no ticks, no Emails): nothing worth a tour. */
  myItems: boolean;
  /** What is stored (null if nothing or blocked). */
  mark: TourMark | null;
  /** Already shown in this page load (covers blocked storage). */
  shownThisSession: boolean;
  /** Automated browsers skip it unless a test opts in with `window.__DC_TOUR__ = true`. */
  automated: boolean;
  optedIn: boolean;
}

/** Whether Review's tour should open by itself. "Show me around" ignores this and always opens it. */
export function shouldAutoShow(c: ShowContext): boolean {
  if (c.fast || c.myItems || c.shownThisSession) return false;
  if (c.automated && !c.optedIn) return false;
  return c.mark === null;
}
