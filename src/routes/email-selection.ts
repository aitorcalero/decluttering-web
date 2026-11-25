// DC-019: what the Review step hands to the Emails step. The review's ticks (item ids) and stale rules become one
// EmailOwner per owner on the list, carrying only that owner's ticked items. Pure apart from the small in-memory store.
import type { Data, Row, Thresholds } from '../domain/types';
import { evaluate, lastUsedWords, noRecordSince, tidyTip } from '../domain/stale';
import { DAY, fmtInt, fmtMonthLong, fmtMonthYear, itemUrl } from '../domain/format';
import { getLocale, t, tn, withLocale, type Locale } from '../i18n';
import type { EmailOwner } from '../ui/emails/digest';
import { depsCheckedOf } from '../scan/pipeline';

export interface EmailSelectionInput {
  data: Data;
  thresholds: Thresholds;
  canSeeUsage: boolean;
  depsKnown: boolean;
  /** DC-086: the admin counts sweep days as use (the review's setting), so the list matches the review. */
  countSweeps?: boolean;
  /** Ticked item ids from the review (dc-selection-change). */
  items: readonly string[];
}

/**
 * DC-083: total views as context, never as blame (research 7.2): "It's been viewed 585,557 times since it was published,
 * but nobody has used it since March." FB-15: it never claims what was not checked, so an unknown last use (or a role
 * without usage) keeps only the views, and no count leaves the sentence out. In the current language.
 */
export function viewsContext(r: Pick<Row, 'numViews' | 'lastUsedDaysAgo' | 'useKnown' | 'noUseRecorded'>, ref: number, canSeeUsage = true): string | null {
  const n = r.numViews;
  if (typeof n !== 'number' || n <= 0) return null;
  const viewed = tn('emails.digest.viewed', n, { count: fmtInt(n) });
  if (!canSeeUsage || !r.useKnown) return t('emails.digest.context', { viewed });
  if (r.noUseRecorded) return t('emails.digest.context.noRecord', { viewed, date: noRecordSince() });
  if (r.lastUsedDaysAgo === null) return t('emails.digest.context.noRequests', { viewed });
  if (r.lastUsedDaysAgo < 30) return t('emails.digest.context', { viewed });
  return t('emails.digest.context.since', { viewed, month: fmtMonthLong(new Date(ref - r.lastUsedDaysAgo * DAY).toISOString(), ref) });
}

/**
 * The why line in an owner email (FB-15, DC-083): last used and last updated, then used-by only when every map and app
 * was checked for this layer. Views are left out here; they get their own sentence (viewsContext). In the current language.
 */
export function emailWhy(r: Row, canSeeUsage: boolean, depsChecked: boolean): string {
  const by = !depsChecked ? null
    : r.usedBy === 0 ? t('review.helpers.by.noMaps') : t(r.usedBy === 1 ? 'review.helpers.by.map' : 'review.helpers.by.maps', { count: fmtInt(r.usedBy) });
  const date = fmtMonthYear(r.lastModified);
  if (!canSeeUsage) return by ? t('emails.digest.why.noUsage', { date, by }) : t('emails.digest.why.noUsage.noBy', { date });
  const lastUsed = lastUsedWords(r);
  return by ? t('emails.digest.why.usage', { lastUsed, date, by }) : t('emails.digest.why.usage.noBy', { lastUsed, date });
}

/**
 * One EmailOwner per owner on the list, with only their ticked items. Every sentence about an item is written in `locale`,
 * the email's language (load it first with ensureLocale), which can differ from the app's.
 */
export function emailOwners(s: EmailSelectionInput, locale: Locale = getLocale()): EmailOwner[] {
  return withLocale(locale, () => {
    const th = s.canSeeUsage ? s.thresholds : { ...s.thresholds, minDaysSinceUse: 0 };
    const ref = Date.parse(s.data.org.scannedAt);
    const ticked = new Set(s.items);
    const ev = evaluate(s.data, th, { depsKnown: s.depsKnown, countSweeps: !!s.countSweeps });
    return ev.owners.map((o) => ({
      username: o.owner.username,
      fullName: o.owner.fullName,
      email: o.owner.email,
      nudgedRecently: o.nudgedRecently,
      nudgedDaysAgo: o.nudgedDaysAgo,
      rows: o.rows.filter((r) => ticked.has(r.source.id)).map((r) => {
        // FB-15: once every map and app is checked (incl. cached data), "used by" is trusted; a partial scan uses each layer's own flag.
        const depsChecked = s.depsKnown ? true : depsCheckedOf(r.source);
        return {
          id: r.source.id,
          title: r.source.title,
          url: itemUrl(s.data.org, r.source),
          credits: r.credits,
          sizeKnown: r.sizeKnown,
          why: emailWhy(r, s.canSeeUsage, depsChecked),
          context: viewsContext(r, ref, s.canSeeUsage),
          depsChecked,
          tidy: tidyTip(r.tidyHints),
          priority: r.priority,
        };
      }),
    }));
  });
}
/** The latest review selection, kept in memory only (never stored: it names owners). */
let latest: EmailSelectionInput | null = null;
export const setEmailSelection = (s: EmailSelectionInput | null): void => { latest = s; };
export const getEmailSelection = (): EmailSelectionInput | null => latest;
