// DC-109 (FB-65): the step model behind the "Scan · Review · Emails" indicator. Pure: no DOM, no router.
export type StepId = 'scan' | 'review' | 'emails';
/** current: where the admin is. link: a step they can go to. disabled: not available yet (see `hint`). */
export type StepState = 'current' | 'link' | 'disabled';

export interface Step { id: StepId; label: string; state: StepState; hint?: string }

export interface StepsInput {
  /** The step on screen. */
  showing: StepId;
  /** The scan has produced data, so Review can be opened. */
  hasData: boolean;
  /** The scan screen can be returned to (false in the quick demo, which opens on Review with no scan). */
  hasScan: boolean;
  /** Owners ticked on Review. */
  ticked: number;
  /** DC-103: no one to nudge (solo admin), or my-items mode: there is no Emails step. */
  noEmails: boolean;
}

export const LABEL: Record<StepId, string> = { scan: 'Scan', review: 'Review', emails: 'Emails' };
export const EMAILS_HINT = 'Tick an owner on Review to write emails.';
const SCAN_HINT = 'The quick demo skips the scan.';
const REVIEW_HINT = 'Review opens once the scan has found your layers.';

export function stepsFor(i: StepsInput): Step[] {
  const ids: StepId[] = i.noEmails && i.showing !== 'emails' ? ['scan', 'review'] : ['scan', 'review', 'emails'];
  return ids.map((id): Step => {
    const label = LABEL[id];
    if (id === i.showing) return { id, label, state: 'current' };
    if (id === 'scan') return i.hasScan ? { id, label, state: 'link' } : { id, label, state: 'disabled', hint: SCAN_HINT };
    if (id === 'review') return i.hasData ? { id, label, state: 'link' } : { id, label, state: 'disabled', hint: REVIEW_HINT };
    return i.hasData && i.ticked > 0 ? { id, label, state: 'link' } : { id, label, state: 'disabled', hint: EMAILS_HINT };
  });
}

/** "Step 2 of 3: Review", for the phone layout and the accessible name. */
export function stepLine(steps: readonly Step[]): string {
  const at = Math.max(0, steps.findIndex((s) => s.state === 'current'));
  return `Step ${at + 1} of ${steps.length}: ${steps[at]?.label ?? ''}`;
}
