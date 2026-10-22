// DC-113 (FB-69): the tour's steps. Copy is short and warm (docs/research/copy-pass.md): two sentences at most.
// Targets are light-DOM elements that already exist (calcite hosts and our wrappers), so no shadow-DOM piercing is needed.

export type TourStepId = 'chart' | 'rules' | 'row' | 'tick' | 'next';

export interface TourStep {
  id: TourStepId;
  selector: string;
  title: string;
  text: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Only makes sense when there are people to email. */
  needsPeople?: boolean;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'chart', selector: '.chart-block', side: 'bottom', title: 'How stale is it?',
    text: 'Each dot is a layer, and the shaded corner is the stale zone. The layers in that corner are the ones worth a look.' },
  { id: 'rules', selector: '.dc-review-side', side: 'right', title: 'What counts as stale',
    text: 'Start with a preset, or change the numbers yourself. The chart and the list follow along.' },
  { id: 'row', selector: 'dc-owner-list [data-card] calcite-list-item', side: 'top', title: 'Why it is listed',
    text: 'Each row says why it made the list and about how many credits a month it uses. The title opens it in ArcGIS Online.' },
  { id: 'tick', selector: 'dc-owner-list [data-card] .owner-foot', side: 'top', needsPeople: true, title: 'One email per owner',
    text: 'Tick the owners you would like to nudge. Each gets a single friendly digest, and nothing is deleted.' },
  { id: 'next', selector: '[data-bar="review"]', side: 'top', needsPeople: true, title: 'Then write the emails',
    text: 'Next: write the emails comes when you are ready. Nothing is sent until you choose.' },
];

/** The steps that apply: alone in the org (solo) there is no one to tick or email, so those steps go. */
export function stepsFor(opts: { solo: boolean }): TourStep[] {
  return TOUR_STEPS.filter((s) => !(opts.solo && s.needsPeople));
}
