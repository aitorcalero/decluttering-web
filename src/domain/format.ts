// Formatters. Pure: no DOM. English keeps its fixed forms ("Mar 2024", "8 months ago"); other languages use Intl in the
// current language (ADR 0015), so owner emails and the review read naturally in each one.
import { getLocale } from '../i18n';
export const DAY = 86400000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const en = (): boolean => getLocale() === 'en';
const dateIn = (opts: Intl.DateTimeFormatOptions, d: Date): string => new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: 'UTC' }).format(d);
export const fmtMonthYear = (iso: string): string => {
  const d = new Date(iso);
  return en() ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : dateIn({ month: 'short', year: 'numeric' }, d);
};
export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return en() ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : dateIn({ day: 'numeric', month: 'short', year: 'numeric' }, d);
};
export const fmtInt = (n: number): string => Math.round(n).toLocaleString(en() ? 'en-US' : getLocale());
export function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  // Round down, never up: a label must not show a value at or above a threshold the item is below (14.96 reads 14.9, not 15).
  const down = (n: number, per: number) => Math.floor(n * per + 1e-9) / per;
  return mb < 100 ? `${down(mb, 10).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.floor(mb)} MB`; // 50 MB, 14.6 MB
}
/**
 * An item's page in the admin's own org: `https://{urlKey}.{customBaseUrl or maps.arcgis.com}/home/item.html?id=…`. Without a
 * urlKey (a scan cached before the org's urlKey was read), www.arcgis.com, which takes a signed-in user to their own org.
 */
export const itemUrl = (org: { urlKey: string; customBaseUrl?: string }, itemOrId: string | { id: string }): string => {
  const id = encodeURIComponent(typeof itemOrId === 'string' ? itemOrId : itemOrId.id);
  const key = (org.urlKey ?? '').trim();
  const base = (org.customBaseUrl ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'maps.arcgis.com';
  if (!key || !/^[a-z0-9-]+$/i.test(key) || !/^[a-z0-9.-]+$/i.test(base)) return `https://www.arcgis.com/home/item.html?id=${id}`;
  return `https://${key}.${base}/home/item.html?id=${id}`;
};

/** "4 weeks ago" / "9 months ago". `ref` is a ms timestamp (default now); pass Date.parse(org.scannedAt) for mock data. */
export function ago(iso: string, ref: number = Date.now()): string {
  return agoDays(Math.floor((ref - Date.parse(iso)) / DAY));
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "March", or "March 2024" when it is not the reference year (for the owner email). */
export const fmtMonthLong = (iso: string, ref: number): string => {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date(ref).getUTCFullYear();
  if (!en()) return dateIn(sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }, d);
  const m = MONTHS_LONG[d.getUTCMonth()] as string;
  return sameYear ? m : `${m} ${d.getUTCFullYear()}`;
};

/** A whole number of days as "today", "5 days ago", "3 weeks ago", "8 months ago" or "2.1 years ago". */
export function agoDays(d: number): string {
  if (!en()) {
    const r = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
    if (d < 1) return r.format(0, 'day');
    if (d < 14) return r.format(-d, 'day');
    if (d < 60) return r.format(-Math.round(d / 7), 'week');
    if (d < 700) return r.format(-Math.round(d / 30.4), 'month');
    return r.format(-Number((d / 365).toFixed(1)), 'year');
  }
  if (d < 1) return 'today';
  if (d === 1) return '1 day ago';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 700) return `${Math.round(d / 30.4)} months ago`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')} years ago`;
}
