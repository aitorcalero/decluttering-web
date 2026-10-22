// DC-019: what the Review step hands to the Emails step. The review's ticks (item ids) and stale rules become one
// EmailOwner per owner on the list, carrying only that owner's ticked items. Pure apart from the small in-memory store.
import type { Data, Row, Thresholds } from '../domain/types';
import { NO_RECORD_SINCE, evaluate } from '../domain/stale';
import { DAY, fmtInt, fmtMonthLong, itemUrl } from '../domain/format';
import { sayWhy } from '../ui/review/helpers';
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
 * without usage) keeps only the views, and no count leaves the sentence out.
 */
export function viewsContext(r: Pick<Row, 'numViews' | 'lastUsedDaysAgo' | 'useKnown' | 'noUseRecorded'>, ref: number, canSeeUsage = true): string | null {
  const n = r.numViews;
  if (typeof n !== 'number' || n <= 0) return null;
  const viewed = `It's been viewed ${n === 1 ? 'once' : `${fmtInt(n)} times`} since it was published`;
  if (!canSeeUsage || !r.useKnown) return `${viewed}.`;
  if (r.noUseRecorded) return `${viewed}, but no use has been recorded since at least ${NO_RECORD_SINCE}.`;
  if (r.lastUsedDaysAgo === null) return `${viewed}, but nobody has asked for its data in the last year.`;
  if (r.lastUsedDaysAgo < 30) return `${viewed}.`;
  return `${viewed}, but nobody has used it since ${fmtMonthLong(new Date(ref - r.lastUsedDaysAgo * DAY).toISOString(), ref)}.`;
}

export function emailOwners(s: EmailSelectionInput): EmailOwner[] {
  const t = s.canSeeUsage ? s.thresholds : { ...s.thresholds, minDaysSinceUse: 0 };
  const ref = Date.parse(s.data.org.scannedAt);
  const ticked = new Set(s.items);
  const ev = evaluate(s.data, t, { depsKnown: s.depsKnown, countSweeps: !!s.countSweeps });
  return ev.owners.map((o) => ({
    username: o.owner.username,
    fullName: o.owner.fullName,
    email: o.owner.email,
    nudgedRecently: o.nudgedRecently,
    nudgedDaysAgo: o.nudgedDaysAgo,
    rows: o.rows.filter((r) => ticked.has(r.source.id)).map((r) => ({
      id: r.source.id,
      title: r.source.title,
      url: itemUrl(s.data.org, r.source),
      credits: r.credits,
      sizeKnown: r.sizeKnown,
      why: sayWhy(r, s.canSeeUsage, s.depsKnown),
      context: viewsContext(r, ref, s.canSeeUsage),
      // FB-15: once every map and app is checked (incl. cached data), "used by" is trusted; a partial scan uses each layer's own flag.
      depsChecked: s.depsKnown ? true : depsCheckedOf(r.source),
      tidy: r.tidy,
      priority: r.priority,
    })),
  }));
}

/** The latest review selection, kept in memory only (never stored: it names owners). */
let latest: EmailSelectionInput | null = null;
export const setEmailSelection = (s: EmailSelectionInput | null): void => { latest = s; };
export const getEmailSelection = (): EmailSelectionInput | null => latest;
