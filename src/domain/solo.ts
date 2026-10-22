// DC-103 (FB-53): when every owner the rule flags is the signed-in admin, there is no one to nudge. Pure TS: no DOM.
import type { EvaluateResult } from './types';

/**
 * True when the rule flags something and every flagged owner is the admin. Disabled owners are not people to nudge
 * (they cannot get email), so they never count. Nothing flagged is not the solo case: that is the "all tidy" state.
 * No admin username (the demo) is never solo.
 */
export function noOneToNudge(evaluated: Pick<EvaluateResult, 'owners'>, adminUsername: string): boolean {
  const me = adminUsername.trim().toLowerCase();
  if (!me || evaluated.owners.length === 0) return false;
  return evaluated.owners.every((o) => o.owner.username.toLowerCase() === me);
}
