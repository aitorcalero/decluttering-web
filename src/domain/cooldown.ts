import type { Owner } from './types';
import { DAY } from './format';

/** Six months, as 182 days (ADR 0005). */
export const COOLDOWN_DAYS = 182;

/** DC-125c (ADR 0013, decision 6): the confirm dialog's line for owners nudged in the last six months, by anyone. Empty for none. */
export function renudgeLine(owners: readonly unknown[]): string {
  const n = owners.length;
  if (!n) return '';
  return `${n} ${n === 1 ? 'owner was' : 'owners were'} nudged in the last six months, by you or another admin.`;
}

/** DC-125c: the fallback when another admin's log could not be read. */
export const othersUnreadableLine = (): string =>
  'The app only knows about nudges you sent yourself, so an owner another admin nudged may not show as resting.';

/** True when the owner was nudged within `days` of `refDate`. A flag for the admin to see, never a skip. */
export function nudgedRecently(owner: Pick<Owner, 'lastNotified'>, refDate: Date | number, days: number = COOLDOWN_DAYS): boolean {
  if (!owner.lastNotified) return false;
  const ref = typeof refDate === 'number' ? refDate : refDate.getTime();
  return Math.floor((ref - Date.parse(owner.lastNotified)) / DAY) <= days;
}
