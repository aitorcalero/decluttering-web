// DC-017: building log rows and reading them back into owners' lastNotified. Pure: no requests, no DOM.
import type { Data, LoggedSend } from '../domain/types';
import type { LogField } from './guard';

/** Written into each row so a later version can tell old rows apart. */
export const APP_VERSION = 'decluttering-web 0.1';
/** Item ids are kept as a comma list; the field holds about 240 of them. */
export const ITEM_IDS_MAX = 8000;

export interface RowInput {
  owner: string;
  sentAt: Date | number | string;
  itemIds: readonly string[];
  credits: number;
  sender: string;
  test?: boolean;
}

export type LogAttributes = Record<LogField, string | number>;

const USERNAME = /^[^\s,]+$/;
const ID32 = /^[0-9a-f]{32}$/;

/**
 * One row: who, when, which items, roughly how many credits, who sent it, and the app version. Built from named
 * inputs only, so an email address or a message body can never reach the table.
 */
export function buildRow(i: RowInput): LogAttributes {
  if (typeof i.owner !== 'string' || !USERNAME.test(i.owner)) throw new Error('Invalid owner username');
  if (typeof i.sender !== 'string' || !USERNAME.test(i.sender)) throw new Error('Invalid sender username');
  const at = i.sentAt instanceof Date ? i.sentAt.getTime() : typeof i.sentAt === 'number' ? i.sentAt : Date.parse(i.sentAt);
  if (!Number.isFinite(at) || at <= 0) throw new Error('Invalid send time');
  const ids = [...new Set(i.itemIds)];
  if (!ids.every((id) => ID32.test(id))) throw new Error('Invalid item id');
  let list = '';
  for (const id of ids) { const next = list ? `${list},${id}` : id; if (next.length > ITEM_IDS_MAX) break; list = next; }
  const credits = Number.isFinite(i.credits) && i.credits > 0 ? Math.round(i.credits * 100) / 100 : 0;
  return {
    owner: i.owner, sent_at: at, item_ids: list, item_count: ids.length, credits,
    sender: i.sender, app_version: APP_VERSION, is_test: i.test ? 1 : 0,
  };
}

/** Owner username to the latest send (ISO), from query features. Rows without an owner or a time are ignored. */
export function latestByOwner(features: readonly { attributes?: Record<string, unknown> }[]): Map<string, string> {
  const best = new Map<string, number>();
  for (const f of features) {
    const a = f?.attributes ?? {};
    const owner = typeof a.owner === 'string' ? a.owner : '';
    const t = typeof a.sent_at === 'number' ? a.sent_at : typeof a.sent_at === 'string' ? Date.parse(a.sent_at) : NaN;
    if (!owner || !Number.isFinite(t)) continue;
    if (t > (best.get(owner) ?? -Infinity)) best.set(owner, t);
  }
  return new Map([...best].map(([o, t]) => [o, new Date(t).toISOString()]));
}

type Feature = { attributes?: Record<string, unknown> };
const timeOf = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN);
const numOf = (v: unknown): number => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? n : 0; };

/** DC-096: the sends, in table order, from query features. Test rows, and rows without an owner or a time, are left out. */
export function sendsOf(features: readonly Feature[]): LoggedSend[] {
  const out: LoggedSend[] = [];
  for (const f of features) {
    const a = f?.attributes ?? {};
    const owner = typeof a.owner === 'string' ? a.owner : '';
    const t = timeOf(a.sent_at);
    if (!owner || !Number.isFinite(t) || Number(a.is_test) === 1) continue;
    const itemIds = typeof a.item_ids === 'string' ? a.item_ids.split(',').map((x) => x.trim()).filter((x) => ID32.test(x)) : [];
    out.push({ owner, sentAt: new Date(t).toISOString(), itemIds, itemCount: Math.round(numOf(a.item_count)), credits: numOf(a.credits) });
  }
  return out;
}

/** DC-096: what one read of the log gives: owner to latest send (as before), plus the sends themselves. */
// A plain Map with the sends as a non-enumerable extra, so callers that only want latest-by-owner see no difference.
export type LogRead = Map<string, string> & { readonly sends: readonly LoggedSend[] };

export function logRead(latest: Iterable<readonly [string, string]> = [], sends: readonly LoggedSend[] = []): LogRead {
  return Object.defineProperty(new Map(latest), 'sends', { value: sends, enumerable: false }) as LogRead;
}

/** One read, two derived views. */
export const readRows = (features: readonly Feature[]): LogRead => logRead(latestByOwner(features), sendsOf(features));

/**
 * Sets each owner's lastNotified to the later of what the data already says and the log. Returns the same object when
 * nothing changes, so callers can memoise on it. Owners not in the data are ignored.
 */
export function applyNudgeLog(data: Data, latest: ReadonlyMap<string, string> | null | undefined): Data {
  if (!latest?.size) return data;
  let changed = false;
  const owners = data.owners.map((o) => {
    const l = latest.get(o.username);
    if (!l) return o;
    if (o.lastNotified && Date.parse(o.lastNotified) >= Date.parse(l)) return o;
    changed = true;
    return { ...o, lastNotified: l };
  });
  return changed ? { ...data, owners } : data;
}

/** Adds one send to a latest-by-owner map (for showing a send at once, before the table is read again). */
export function withSend(latest: ReadonlyMap<string, string> | null | undefined, owner: string, at: Date): Map<string, string> {
  const m = new Map(latest ?? []);
  const prev = m.get(owner);
  if (!prev || Date.parse(prev) < at.getTime()) m.set(owner, at.toISOString());
  return m;
}
