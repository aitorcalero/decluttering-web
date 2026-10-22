// Small pure text helpers shared by the review components. No DOM.
import { fmtInt } from '../../domain/format';

export const plural = (n: number, one: string, many: string): string => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** Credits a month: one decimal under 10, whole numbers above. */
export const credit = (c: number): string => (c < 10 ? c.toFixed(1) : fmtInt(c));

export const firstName = (fullName: string): string => fullName.split(' ')[0] || fullName;

export const roleLabel = (role?: string): string =>
  role === 'org_admin' ? 'Admin' : role === 'org_publisher' ? 'Publisher' : 'Member';

/** Weeks since a digest, at least 1, for "Nudged 3 weeks ago". */
export const weeksAgo = (days: number | null): number => Math.max(1, Math.round((days ?? 0) / 7));

/** "today", "yesterday", "3 days ago", "2 weeks ago", "4 months ago": for "Nudged …" (DC-017: a nudge sent today said "1 week ago"). */
export function agoText(days: number | null): string {
  const d = Math.max(0, Math.floor(days ?? 0));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 63) { const w = Math.round(d / 7); return `${w} ${w === 1 ? 'week' : 'weeks'} ago`; }
  const m = Math.round(d / 30.4);
  return `${m} months ago`;
}
