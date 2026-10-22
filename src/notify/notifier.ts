// The real group notifier (DC-018, ADR 0002). Email goes out through one hidden, invitation-only group that the admin
// owns: find-or-create the group, then add -> notify -> remove per owner. A test goes only to the signed-in admin, who
// owns the group and so needs no add or remove. Every request goes through the notifier's own allow-list (./guard).
// API facts: docs/research/agol-notify-usage.md, section 4 and "DC-012 results".
import { GROUP_TITLE, guardNotifyRequest } from './guard';
import { SEND_THUMBNAILS, createThumbnailLoader, type ParamValue, type ThumbnailLoader } from './thumbnail';
import type { RequestFn } from '../scan/types';
import { READ_ONLY_NOTE } from '../auth/write-allowed';
import { mayOptIn, type SendingMode } from '../auth/sending';

export { GROUP_TITLE };

/** addUsers and removeUsers accept at most 25 users per call (CONFIRMED, S2/S3). */
export const MAX_USERS_PER_CALL = 25;

// The group's labels in ArcGIS Online (ADR 0012, research section 2): what it is, who made it, how to remove it.
export const GROUP_DESCRIPTION =
  'Created by the Decluttering app to email owners about items that may no longer be needed. ' +
  'Each owner is added, sent one email, and removed again, so the group is normally empty. ' +
  'Only you can see it. It holds no items. ' +
  'To remove it, open the Decluttering app > About > App data in your org, or delete it here.';
export const GROUP_SNIPPET = 'Used by the Decluttering app to email owners. Normally empty. Safe to delete.';
export const GROUP_TAGS = 'Decluttering,decluttering-notifications';

export interface AppGroup { id: string; title: string; owner: string; access: string; hidden: true; reused: boolean;
  /** DC-122: true only when this call created the group with its thumbnail accepted. False when none was sent, when ArcGIS refused it, and for a reused group. */
  thumbnail?: boolean }

export type MessageFormat = 'html' | 'text';

/** What was actually sent, for the inbox check. Never contains a token. */
export interface SendRecord {
  to: string[];
  groupId: string;
  subject: string;
  subjectLength: number;
  messageLength: number;
  format: MessageFormat;
  at: string;
}

export interface OwnerSendResult {
  username: string;
  sent: boolean;
  /** Set when addUsers reported the owner in notAdded; nothing was sent. */
  notAdded?: boolean;
  /** Usernames removeUsers reported in notRemoved (left in the group; tidied on the next run). */
  notRemoved: string[];
  record?: SendRecord;
}

/** Thrown when a notifier is asked for in an org this build may not write to (DC-058). Nothing was sent or created. */
export class WritesDisabled extends Error {
  constructor(reason = READ_ONLY_NOTE) {
    super(reason);
    this.name = 'WritesDisabled';
  }
}

export interface GroupNotifierOptions {
  /** Raw (unguarded) authenticated request; the notifier guards it. */
  request: RequestFn;
  /** The signed-in org's id (portals/self.id). The notifier refuses to exist unless it is in `writableOrgIds`. */
  orgId: string;
  /** Orgs that may opt in when the mode is `list`. Defaults to VITE_WRITABLE_ORG_IDS; given alone (tests) it means `list` mode. */
  writableOrgIds?: string | readonly string[];
  /** Overrides VITE_SENDING (tests only). */
  sendingMode?: SendingMode;
  /** The signed-in username, if already known (otherwise read from portals/self). */
  self?: string;
  now?: () => Date;
  /** Send the group's thumbnail on createGroup. Defaults to SEND_THUMBNAILS (off until the live check passes). */
  sendThumbnails?: boolean;
  /** Where the thumbnail comes from. Defaults to a same-origin fetch of the app's own PNG. Tests inject one. */
  loadThumbnail?: ThumbnailLoader;
}

interface PortalSelf { id?: string; user?: { username?: string; privileges?: string[] } }
interface GroupLike { id?: string; title?: string; owner?: string; access?: string }

export const CREATE_GROUP_PRIVILEGE = 'portal:user:createGroup';

/** A plain-text fallback for createNotification (HTML is CONFIRMED rendered, DC-012; kept in case that changes). */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => `${text.replace(/<[^>]+>/g, '')} (${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function checkUsernames(users: string[]): string[] {
  if (!users.length) throw new Error('No recipients');
  for (const u of users) {
    if (typeof u !== 'string' || !u.trim() || u !== u.trim() || /[,\s]/.test(u)) throw new Error('Invalid username');
  }
  return users;
}

const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export interface TidyResult { removed: string[]; notRemoved: string[] }

export interface GroupNotifier {
  readonly group: AppGroup | null;
  whoAmI(): Promise<string>;
  canCreateGroup(): Promise<{ ok: boolean; missing?: string }>;
  findGroup(): Promise<AppGroup | null>;
  /** Find-or-create the app's hidden group. Reuses an existing one with the exact title owned by the signed-in user. */
  createGroup(): Promise<AppGroup>;
  /** Deletes the app's own group only: the id this notifier holds, re-checked for the exact title and owner. */
  deleteGroup(): Promise<void>;
  add(users: string[]): Promise<string[]>;
  notify(users: string[], subject: string, message: string, format?: MessageFormat): Promise<SendRecord>;
  remove(users: string[]): Promise<string[]>;
  /** Takes everyone except the signed-in admin out of the app's group (leftovers of an interrupted run, ADR 0002). Never adds. */
  tidyGroup(): Promise<TidyResult>;
  /** One owner: add -> notify -> remove. The remove is always attempted once the add was tried. */
  sendToOwner(username: string, subject: string, html: string, format?: MessageFormat): Promise<OwnerSendResult>;
  /** Sends only to the signed-in user. There is no way to name another recipient. */
  sendTest(subject: string, html: string, format?: MessageFormat): Promise<SendRecord>;
}

export function createGroupNotifier(opts: GroupNotifierOptions): GroupNotifier {
  // Default deny (DC-058, ADR 0013): no notifier, and so no route to any write, unless this org may opt in to sending.
  if (!mayOptIn(opts.orgId, opts)) throw new WritesDisabled();
  const orgId = opts.orgId.trim();
  const now = opts.now ?? (() => new Date());
  let self: string | null = opts.self ?? null;
  let privileges: string[] | null = null;
  let group: AppGroup | null = null;
  const sendThumbnails = opts.sendThumbnails ?? SEND_THUMBNAILS;
  const loadThumbnail = opts.loadThumbnail ?? createThumbnailLoader();
  const req = guardNotifyRequest(opts.request, () => ({ self, groupId: group?.id ?? null }));

  async function portalSelf(): Promise<void> {
    const p = (await req('portals/self', {}, { method: 'GET' })) as PortalSelf;
    const u = p?.user?.username;
    if (!u) throw new Error('Could not tell who is signed in');
    // The portal says which org this session is really in: it must be the writable org the notifier was built for.
    if (typeof p.id === 'string' && p.id !== orgId) throw new WritesDisabled('The signed-in organisation changed, so sending is switched off.');
    if (self && self !== u) throw new Error('The signed-in user changed');
    self = u;
    privileges = Array.isArray(p.user?.privileges) ? p.user!.privileges! : [];
  }
  async function whoAmI(): Promise<string> {
    if (!self) await portalSelf();
    return self!;
  }
  const needGroup = (): AppGroup => {
    if (!group) throw new Error('The hidden group is not set up yet');
    return group;
  };
  const asGroup = (g: GroupLike, reused: boolean): AppGroup => ({
    id: String(g.id), title: String(g.title), owner: String(g.owner ?? self), access: String(g.access ?? 'private'), hidden: true, reused,
  });

  async function searchOwn(): Promise<GroupLike[]> {
    const me = await whoAmI();
    const res = (await req('community/groups', { q: `title:"${GROUP_TITLE}" AND owner:${me}`, num: 100 }, { method: 'GET' })) as { results?: GroupLike[] };
    return (res?.results ?? []).filter((g) => g.title === GROUP_TITLE && g.owner === me && typeof g.id === 'string' && /^[0-9a-f]{32}$/.test(g.id));
  }

  async function notify(users: string[], subject: string, message: string, format: MessageFormat = 'html'): Promise<SendRecord> {
    const g = needGroup();
    checkUsernames(users);
    if (!subject.trim()) throw new Error('The subject is empty');
    const body = format === 'text' ? htmlToText(message) : message;
    const res = (await req(`community/groups/${g.id}/createNotification`, {
      notificationChannelType: 'email', subject, message: body, users: users.join(','),
    }, { method: 'POST' })) as { success?: boolean };
    if (res?.success !== true) throw new Error('ArcGIS Online did not confirm the email');
    return { to: [...users], groupId: g.id, subject, subjectLength: subject.length, messageLength: body.length, format, at: now().toISOString() };
  }

  async function membership(op: 'addUsers' | 'removeUsers', users: string[]): Promise<string[]> {
    const g = needGroup();
    checkUsernames(users);
    const left: string[] = [];
    for (const batch of chunks(users, MAX_USERS_PER_CALL)) {
      const res = (await req(`community/groups/${g.id}/${op}`, { users: batch.join(',') }, { method: 'POST' })) as Record<string, unknown>;
      const key = op === 'addUsers' ? 'notAdded' : 'notRemoved';
      const list = Array.isArray(res?.[key]) ? (res[key] as unknown[]).map(String) : [];
      left.push(...list);
    }
    return left;
  }

  const api: GroupNotifier = {
    get group() { return group; },
    whoAmI,
    async canCreateGroup() {
      if (privileges === null) await portalSelf();
      return privileges!.includes(CREATE_GROUP_PRIVILEGE) ? { ok: true } : { ok: false, missing: 'the “Create groups” privilege' };
    },
    async findGroup() {
      const [g] = await searchOwn();
      group = g ? asGroup(g, true) : null;
      return group;
    },
    async createGroup() {
      if (group) return group;
      const found = await api.findGroup();
      if (found) return found;
      const params: Record<string, ParamValue> = {
        title: GROUP_TITLE,
        access: 'private',
        isInvitationOnly: 'true',
        isViewOnly: 'true',
        hiddenMembers: 'true',
        tags: GROUP_TAGS,
        snippet: GROUP_SNIPPET,
        description: GROUP_DESCRIPTION,
      };
      // Decoration only: a missing or refused thumbnail never stops the group being made.
      const thumb = sendThumbnails ? await loadThumbnail('group').catch(() => null) : null;
      if (thumb) params.thumbnail = thumb;
      // A Blob value goes through untouched and arcgis-rest-js sends it as a multipart part (encode-form-data.js).
      const post = async (p: Record<string, ParamValue>) => {
        const r = (await req('community/createGroup', p as Record<string, string | number>, { method: 'POST' })) as { success?: boolean; group?: GroupLike };
        const gr = r?.group;
        if (!r?.success || !gr?.id || !/^[0-9a-f]{32}$/.test(String(gr.id))) throw new Error('ArcGIS Online did not create the group');
        return gr;
      };
      let g: GroupLike;
      let withThumb = !!thumb;
      try {
        g = await post(params);
      } catch (e) {
        // DC-122: ArcGIS refused the request with the thumbnail on it: try once more without it, through the same guard.
        // A guard block is ours, not ArcGIS's, so it is not retried.
        if (!thumb || (e instanceof Error && e.name === 'BlockedRequest')) throw e;
        const { thumbnail: _dropped, ...plain } = params;
        void _dropped;
        g = await post(plain);
        withThumb = false;
      }
      group = { ...asGroup({ ...g, title: g.title ?? GROUP_TITLE, owner: g.owner ?? self ?? undefined }, false), thumbnail: withThumb };
      if (group.title !== GROUP_TITLE) { const t = group.title; group = null; throw new Error(`Unexpected group title: ${t}`); }
      return group;
    },
    async deleteGroup() {
      const g = needGroup();
      if (g.title !== GROUP_TITLE) throw new Error('Refusing to delete a group that is not the app’s own');
      const mine = await searchOwn();
      if (!mine.some((x) => x.id === g.id)) throw new Error('Refusing to delete: that group is not the app’s own');
      await req(`community/groups/${g.id}/delete`, {}, { method: 'POST' });
      group = null;
    },
    add: (users) => membership('addUsers', users),
    remove: (users) => membership('removeUsers', users),
    notify,
    async tidyGroup() {
      const me = await whoAmI();
      const g = needGroup();
      const res = (await req(`community/groups/${g.id}/users`, {}, { method: 'GET' })) as { owner?: unknown; admins?: unknown; users?: unknown };
      const names = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
      const keep = new Set([me, ...(typeof res?.owner === 'string' ? [res.owner] : [])]);
      const others = [...new Set([...names(res?.admins), ...names(res?.users)])].filter((u) => u && !keep.has(u));
      if (!others.length) return { removed: [], notRemoved: [] };
      const notRemoved = await membership('removeUsers', others);
      return { removed: others.filter((u) => !notRemoved.includes(u)), notRemoved };
    },
    async sendToOwner(username, subject, html, format = 'html') {
      const me = await whoAmI();
      needGroup();
      checkUsernames([username]);
      if (username === me) return { username, sent: true, notRemoved: [], record: await notify([me], subject, html, format) };
      const removeAgain = async (): Promise<string[]> => {
        try { return await membership('removeUsers', [username]); } catch { return [username]; }
      };
      let notAdded: string[];
      try {
        notAdded = await membership('addUsers', [username]);
      } catch (e) {
        // The add may have half-happened: still try to take the owner out again.
        const notRemoved = await removeAgain();
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { notRemoved });
      }
      if (notAdded.includes(username)) return { username, sent: false, notAdded: true, notRemoved: [] };
      let record: SendRecord;
      try {
        record = await notify([username], subject, html, format);
      } catch (e) {
        const notRemoved = await removeAgain();
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { notRemoved });
      }
      return { username, sent: true, notRemoved: await removeAgain(), record };
    },
    async sendTest(subject, html, format = 'html') {
      const me = await whoAmI();
      return notify([me], subject, html, format);
    },
  };
  return api;
}
