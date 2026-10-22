import type { Owner } from './types';
import { DAY } from './format';

/** Six months, as 182 days (ADR 0005). */
export const COOLDOWN_DAYS = 182;

/** True when the owner was nudged within `days` of `refDate`. A flag for the admin to see, never a skip. */
export function nudgedRecently(owner: Pick<Owner, 'lastNotified'>, refDate: Date | number, days: number = COOLDOWN_DAYS): boolean {
  if (!owner.lastNotified) return false;
  const ref = typeof refDate === 'number' ? refDate : refDate.getTime();
  return Math.floor((ref - Date.parse(owner.lastNotified)) / DAY) <= days;
}
