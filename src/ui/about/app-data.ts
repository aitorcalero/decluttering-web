// ADR 0012: what the "App data in your org" section on About does, as plain functions so it can be tested without a DOM.
// Finding what the app made is read-only (findGroup, the log's find and read). Removing is only ever called from an explicit
// confirm in <dc-app-data>. Both removals go through the notifier and the log, and so through their allow-lists and
// re-checks; nothing here sends a request of its own.
import { GROUP_TITLE, type GroupNotifier } from '../../notify';
import { LOG_TITLE, type NudgeLog } from '../../log';
import { itemUrl } from '../../domain/format';

/** What the section needs of the org: its id (the log's cache key) and where its pages live. */
export interface AppDataOrg { id: string; urlKey: string; customBaseUrl?: string }

export interface AppDataProps {
  notifier?: GroupNotifier | null;
  nudgeLog?: NudgeLog | null;
  writable?: boolean;
  org?: AppDataOrg | null;
}

export interface FoundGroup { id: string; title: string; href: string }
export interface FoundLog { itemId: string; title: string; href: string; /** Sends recorded (test rows left out); null when the read failed. */ sends: number | null }
export interface AppData { group: FoundGroup | null; log: FoundLog | null }

/** The section exists only for a writable org with something to look for. A read-only org gets nothing, not even a probe. */
export function canShowAppData(p: AppDataProps): boolean {
  return p.writable === true && !!p.org && !!p.org.id && !!(p.notifier || p.nudgeLog);
}

const groupHref = (org: AppDataOrg, id: string): string => itemUrl(org, id).replace('/home/item.html?', '/home/group.html?');
const itemHref = (org: AppDataOrg, id: string): string => itemUrl(org, id);

/**
 * Looks for the app's own group and log. Read only. Returns null when `signal` aborted (the caller drops the result);
 * a failed read of one thing leaves it out rather than guessing.
 */
export async function detectAppData(p: AppDataProps, signal?: AbortSignal | null): Promise<AppData | null> {
  const none: AppData = { group: null, log: null };
  if (!canShowAppData(p)) return none;
  const org = p.org!;
  const out: AppData = { group: null, log: null };
  if (p.notifier) {
    const g = await p.notifier.findGroup().catch(() => null);
    if (signal?.aborted) return null;
    if (g) out.group = { id: g.id, title: g.title, href: groupHref(org, g.id) };
  }
  if (p.nudgeLog) {
    const t = await p.nudgeLog.find().catch(() => null);
    if (signal?.aborted) return null;
    if (t) {
      const sends = await p.nudgeLog.read().then((r) => r.sends.length, () => null);
      if (signal?.aborted) return null;
      out.log = { itemId: t.itemId, title: t.title === LOG_TITLE ? t.title : LOG_TITLE, href: itemHref(org, t.itemId), sends };
    }
  }
  return out;
}

export type RemoveOutcome =
  | { ok: true; /** True when it was already gone, which counts as success. */ already: boolean }
  | { ok: false; message: string; href: string };

const notFound = (e: unknown): boolean => {
  const x = e as { code?: unknown; message?: unknown } | null;
  return x?.code === 404 || /does not exist|not found/i.test(String(x?.message ?? ''));
};

/** Removes the app's own group. Not found counts as success; any other error gives the friendly message and a link. */
export async function removeAppGroup(notifier: GroupNotifier, org: AppDataOrg): Promise<RemoveOutcome> {
  let found: Awaited<ReturnType<GroupNotifier['findGroup']>> = null;
  try {
    found = await notifier.findGroup();
    if (!found) return { ok: true, already: true };
    await notifier.deleteGroup();
    return { ok: true, already: false };
  } catch (e) {
    if (notFound(e)) return { ok: true, already: true };
    return { ok: false, message: COPY.groupFailed, href: found ? groupHref(org, found.id) : groupsHref(org) };
  }
}

/** Deletes the app's own log. Same outcomes as removeAppGroup. */
export async function removeAppLog(nudgeLog: NudgeLog, org: AppDataOrg, itemId: string): Promise<RemoveOutcome> {
  if (!nudgeLog.deleteLog) return { ok: false, message: COPY.logFailed, href: itemHref(org, itemId) };
  try {
    const r = await nudgeLog.deleteLog();
    return { ok: true, already: r === 'gone' };
  } catch (e) {
    if (notFound(e)) return { ok: true, already: true };
    return { ok: false, message: COPY.logFailed, href: itemHref(org, itemId) };
  }
}

const groupsHref = (org: AppDataOrg): string => groupHref(org, '').replace('group.html?id=', 'groups.html');

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The words on the section, from docs/research/app-data-lifecycle.md section 3. */
export const COPY = {
  heading: 'App data in your org',
  intro: 'The app made these in your org. Removing one only removes the app’s own thing, never anyone’s items.',
  loading: 'Checking what the app has in your org…',
  groupRow: `Hidden group: ${GROUP_TITLE}`,
  groupNote: 'Normally empty; only you can see it.',
  logRow: `Nudge log: ${LOG_TITLE}`,
  logNote: (sends: number | null): string => (sends === null ? 'Who was nudged, and when.' : `${plural(sends, 'send', 'sends')} recorded.`),
  open: 'Open in ArcGIS Online',
  removeGroup: 'Remove group…',
  deleteLog: 'Delete log…',
  keep: 'Keep it',
  groupConfirmHeading: 'Remove the hidden group?',
  groupConfirm: `Only the app's own group goes: “${GROUP_TITLE}”. Nobody's items or accounts are touched. If you send again, we'll ask before creating it again.`,
  groupConfirmButton: 'Remove group',
  logConfirmHeading: 'Delete the nudge log?',
  logConfirm: (rows: number | null): string =>
    `This deletes the table “${LOG_TITLE}” from your content, with ${rows === null ? 'its rows' : `its ${plural(rows, 'row', 'rows')}`}. ` +
    'We lose the record of who you nudged, so owners could be nudged again sooner than six months, and Review can no longer show what happened since a nudge. ' +
    "Nobody's items are touched.",
  logConfirmButton: 'Delete log',
  groupFailed: 'ArcGIS Online wouldn’t remove it. You can remove it yourself under Groups.',
  logFailed: 'ArcGIS Online wouldn’t delete it. You can remove it yourself in Content.',
  groupDone: 'The hidden group was removed. Nobody’s items were touched.',
  logDone: 'The nudge log was deleted. Nobody’s items were touched.',
  busy: 'Available again when the send finishes.',
} as const;
