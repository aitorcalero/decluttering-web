// DC-113 (FB-69): the tour's front door. Small and in the main chunk; Driver.js and its styles load only when the tour opens.
import { readMark, shouldAutoShow, type ShowContext } from './rule';

export { TOUR_KEY, readMark, writeMark, shouldAutoShow } from './rule';
export { stepsFor, TOUR_STEPS } from './steps';

let shownThisSession = false;

type TourWindow = Window & { __DC_TOUR__?: boolean };

/** Opens the tour (lazily). "Show me around" calls this directly, so it ignores the stored choice. */
export async function openReviewTour(opts: { solo: boolean; onEnd?: () => void }): Promise<boolean> {
  const { startReviewTour } = await import('./review-tour');
  const ok = startReviewTour(opts);
  if (ok) shownThisSession = true;
  return ok;
}

/** Closes the tour if it is open (for example when the person leaves Review). */
export async function closeReviewTour(): Promise<void> {
  (await import('./review-tour')).stopReviewTour();
}

/** Opens the tour by itself if the rules allow it: 'skip' (rules say no), 'wait' (not enough on screen yet, try again), or 'open'. */
export async function autoStartReviewTour(opts: { fast: boolean; myItems: boolean; solo: boolean; onEnd?: () => void }): Promise<'skip' | 'wait' | 'open'> {
  const ctx: ShowContext = {
    fast: opts.fast, myItems: opts.myItems, mark: readMark(), shownThisSession,
    automated: typeof navigator !== 'undefined' && navigator.webdriver === true, optedIn: (window as TourWindow).__DC_TOUR__ === true,
  };
  if (!shouldAutoShow(ctx)) return 'skip';
  return (await openReviewTour(opts)) ? 'open' : 'wait';
}
