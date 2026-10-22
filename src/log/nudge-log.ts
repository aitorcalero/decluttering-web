// DC-017 (ADR 0005 tier 3): the nudge log. One private hosted table in the admin's own content, found first and created
// only on the admin's explicit choice at a real send. Adds rows, reads them back; never deletes anything. The one update
// is the log item's own title (DC-075), at create time only, never on a read, plus its thumbnail (ADR 0012). The one
// delete is the admin's explicit request from About (ADR 0012): the app's own log item, re-checked just before.
// Every request goes through ./guard. Default deny by org, like the notifier (DC-058).
import { mayOptIn, type SendingMode } from '../auth/sending';
import { WritesDisabled } from '../notify/notifier';
import { SEND_THUMBNAILS, createThumbnailLoader, type ParamValue, type ThumbnailLoader } from '../notify/thumbnail';
import type { Sender } from '../scan/request';
import {
  adminUrlOf, assertLogAllowed, assertOtherLogReadAllowed, isLogServiceUrl, LOG_FIELDS, LOG_NAME_RE, LOG_TABLE_NAME, LOG_TAG, LOG_TITLE, type LogGuardContext,
} from './guard';
import { buildRow, logRead, readRows, type LogRead, type RowInput } from './rows';

export interface LogTable {
  itemId: string;
  title: string;
  serviceUrl: string;
  owner: string;
  access: string;
  /** False when this session created it. */
  reused: boolean;
}

/** DC-125c: what reading the other admins' logs gave. `unreadable`: a log (or the search for them) could not be read. */
export interface OthersRead { reads: { admin: string; read: LogRead }[]; unreadable: boolean }

export interface NudgeLog {
  readonly table: LogTable | null;
  whoAmI(): Promise<string>;
  /** Looks for the app's log in the signed-in user's own items. Read only. */
  find(): Promise<LogTable | null>;
  /** Find-or-create. Creates only when none is found. */
  create(): Promise<LogTable>;
  /** Adds one row (applyEdits adds). Returns the new object id. */
  record(row: RowInput): Promise<number>;
  /** DC-125c: every app log in the signed-in org, any owner. Search only (GET); changes nothing, including `table`. */
  findAllInOrg(): Promise<LogTable[]>;
  /** DC-125c: reads the other admins' logs, query only (GET), through the read-only guard. Never throws; see OthersRead. */
  readOthers(): Promise<OthersRead>;
  /** Owner username to their latest logged send (ISO), with the sends themselves (DC-096). Empty when there is no log. GET only. */
  read(): Promise<LogRead>;
  /**
   * ADR 0012: deletes the app's own log item, on the admin's explicit request only. The item is read again first and must
   * still be ours (owner, title, tag, type, service url). 'gone' means it was already not there; nothing was sent.
   * Posts no parameters (no permanentDelete, no force).
   */
  deleteLog(): Promise<'deleted' | 'gone'>;
}

export interface NudgeLogOptions {
  /** Raw (unguarded) sender taking absolute URLs; the log guards it. */
  send: Sender;
  portal: string;
  orgId: string;
  writableOrgIds?: string | readonly string[];
  /** Overrides VITE_SENDING (tests only). */
  sendingMode?: SendingMode;
  self?: string;
  /** Test hook for the service-name suffix. */
  random?: () => string;
  /** Send the log's thumbnail on the item update. Defaults to SEND_THUMBNAILS (off until the live check passes). */
  sendThumbnails?: boolean;
  /** Where the thumbnail comes from. Defaults to a same-origin fetch of the app's own PNG. Tests inject one. */
  loadThumbnail?: ThumbnailLoader;
}

export const LOG_DESCRIPTION =
  'Created by the Decluttering app. Remembers which owners were sent a tidy-up email, when, and about which items, ' +
  'so later runs can let them rest for six months. It holds no email addresses and no message text. ' +
  'Only you can see it. You can delete it from the Decluttering app (About > App data in your org) or here ' +
  '(Content > this item > Delete). Deleting it means owners could be nudged again sooner than six months.';

export const LOG_SNIPPET = 'Who the Decluttering app nudged, and when. Private; safe to delete.';

const str = (n: number) => ({ type: 'esriFieldTypeString', length: n });
/** The table definition for addToDefinition (no geometry). */
export function tableDefinition() {
  const f = (name: string, alias: string, t: Record<string, unknown>) => ({ name, alias, nullable: true, editable: true, ...t });
  return {
    tables: [{
      id: 0, name: LOG_TABLE_NAME, type: 'Table', objectIdField: 'OBJECTID', displayField: 'owner',
      description: 'One row per owner per send.', capabilities: 'Create,Editing,Query',
      fields: [
        { name: 'OBJECTID', alias: 'OBJECTID', type: 'esriFieldTypeOID', nullable: false, editable: false },
        f('owner', 'Owner username', str(128)),
        f('sent_at', 'Sent at', { type: 'esriFieldTypeDate', length: 8 }),
        f('item_ids', 'Item ids', str(8000)),
        f('item_count', 'Item count', { type: 'esriFieldTypeInteger' }),
        f('credits', 'Credits a month (estimate)', { type: 'esriFieldTypeDouble' }),
        f('sender', 'Sent by', str(128)),
        f('app_version', 'App version', str(32)),
        f('is_test', 'Test row', { type: 'esriFieldTypeSmallInteger' }),
      ],
    }],
  };
}

const randomHex = (): string => {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

interface ItemLike { id?: unknown; title?: unknown; owner?: unknown; access?: unknown; url?: unknown; tags?: unknown; type?: unknown; created?: unknown }

/** True for a search result that is the app's own log, owned by `me`. */
export function isAppLog(it: ItemLike, me: string): boolean {
  const tags = Array.isArray(it.tags) ? it.tags.map(String) : [];
  const title = String(it.title ?? '');
  return it.owner === me && it.type === 'Feature Service' && typeof it.id === 'string' && /^[0-9a-f]{32}$/.test(it.id)
    && tags.includes(LOG_TAG) && (title === LOG_TITLE || LOG_NAME_RE.test(title)) && isLogServiceUrl(it.url);
}

/** DC-125c: like isAppLog for a log of any owner (the owner just has to be named). */
export function isAppLogAnyOwner(it: ItemLike): boolean {
  return typeof it.owner === 'string' && it.owner.length > 0 && isAppLog(it, it.owner);
}

/**
 * DC-125c: a sender for other admins' logs that checks assertOtherLogReadAllowed before any request: a GET query on a
 * service with the app's log shape, nothing else. No write can go through it.
 */
export function guardedOtherSend(send: Sender, portal: string): Sender {
  return async (url, o) => {
    assertOtherLogReadAllowed(url, o.method, o.params, portal);
    return send(url, o);
  };
}

const QUERY_FIELDS = 'owner,sent_at,item_ids,item_count,credits,is_test';

export function createNudgeLog(opts: NudgeLogOptions): NudgeLog {
  if (!mayOptIn(opts.orgId, opts)) throw new WritesDisabled();
  const portal = opts.portal.replace(/\/+$/, '');
  const rest = `${portal}/sharing/rest`;
  const ctx: LogGuardContext = { portal, self: opts.self ?? null, serviceUrl: null, newServiceUrl: null };
  let table: LogTable | null = null;
  const sendThumbnails = opts.sendThumbnails ?? SEND_THUMBNAILS;
  const loadThumbnail = opts.loadThumbnail ?? createThumbnailLoader();

  async function req(url: string, params: Record<string, ParamValue>, method: 'GET' | 'POST'): Promise<Record<string, unknown>> {
    assertLogAllowed(url, method, params, ctx);
    // A Blob value goes through untouched and arcgis-rest-js sends it as a multipart part (encode-form-data.js).
    const res = (await opts.send(url, { method, params: params as Record<string, string | number> })) as Record<string, unknown> | null;
    const err = res?.error as { code?: unknown; message?: unknown } | undefined;
    if (err) throw Object.assign(new Error(`ArcGIS Online said no: ${String(err.message ?? err.code ?? 'error')}`), { code: err.code });
    return res ?? {};
  }

  /** An ArcGIS error body becomes a thrown error, as `req` does. */
  function unwrap(res: unknown): Record<string, unknown> {
    const r = (res ?? {}) as Record<string, unknown>;
    const err = r.error as { code?: unknown; message?: unknown } | undefined;
    if (err) throw Object.assign(new Error(`ArcGIS Online said no: ${String(err.message ?? err.code ?? 'error')}`), { code: err.code });
    return r;
  }

  /** The table's rows, a page at a time, through `get` (own log: the full guard; another admin's: the read-only guard). */
  async function queryAll(serviceUrl: string, get: (url: string, params: Record<string, ParamValue>) => Promise<Record<string, unknown>>): Promise<{ attributes?: Record<string, unknown> }[]> {
    const features: { attributes?: Record<string, unknown> }[] = [];
    for (let page = 0, offset = 0; page < 25; page++) {
      const res = await get(`${serviceUrl}/0/query`, {
        where: '1=1', outFields: QUERY_FIELDS, returnGeometry: 'false', orderByFields: 'OBJECTID ASC',
        resultOffset: offset, resultRecordCount: 2000,
      }) as { features?: { attributes?: Record<string, unknown> }[]; exceededTransferLimit?: unknown };
      const batch = res.features ?? [];
      features.push(...batch);
      if (res.exceededTransferLimit !== true || !batch.length) break;
      offset += batch.length;
    }
    return features;
  }

  async function whoAmI(): Promise<string> {
    if (ctx.self) return ctx.self;
    const p = await req(`${rest}/portals/self`, {}, 'GET') as { id?: unknown; user?: { username?: unknown } };
    if (typeof p.id === 'string' && p.id !== opts.orgId.trim()) throw new WritesDisabled('The signed-in organisation changed, so the nudge log is switched off.');
    const u = p.user?.username;
    if (typeof u !== 'string' || !u) throw new Error('Could not tell who is signed in');
    ctx.self = u;
    return u;
  }

  const asTable = (it: ItemLike, reused: boolean): LogTable => ({
    itemId: String(it.id), title: String(it.title), serviceUrl: String(it.url), owner: String(it.owner), access: String(it.access ?? 'private'), reused,
  });

  /**
   * DC-075: ArcGIS Online titles the item with its service name; set the app's title. ADR 0012: the thumbnail goes on the
   * same update, so no extra write: for a log created now, or one that needed its title set. A log that is already right
   * is left alone. Best effort: the log works either way.
   */
  async function retitle(t: LogTable, created = false): Promise<LogTable> {
    const needTitle = t.title !== LOG_TITLE;
    const thumb = sendThumbnails && (needTitle || created) ? await loadThumbnail('log').catch(() => null) : null;
    if (!needTitle && !thumb) return t;
    ctx.logItemId = t.itemId;
    const params: Record<string, ParamValue> = { title: LOG_TITLE };
    if (thumb) params.thumbnail = thumb;
    const attempt = async (p: Record<string, ParamValue>): Promise<boolean> => {
      const r = await req(`${rest}/content/users/${await whoAmI()}/items/${t.itemId}/update`, p, 'POST');
      return r.success === true;
    };
    try {
      if (await attempt(params)) return { ...t, title: LOG_TITLE };
    } catch (e) {
      // A guard block is ours, not ArcGIS's: not retried.
      if (e instanceof Error && e.name === 'BlockedRequest') return t;
    }
    if (!thumb) return t;
    // DC-122: ArcGIS refused the update with the thumbnail on it: retry once with the title alone, so the log is never untitled.
    try {
      return (await attempt({ title: LOG_TITLE })) ? { ...t, title: LOG_TITLE } : t;
    } catch { return t; }
  }

  /** The item with this id among the user's own items, read again: search first, then the root content list. Null when neither shows it. */
  async function locate(itemId: string, me: string): Promise<ItemLike | null> {
    const res = await req(`${rest}/search`, {
      q: `owner:"${me}" AND tags:"${LOG_TAG}" AND type:"Feature Service"`, num: 100, sortField: 'created', sortOrder: 'asc',
    }, 'GET') as { results?: ItemLike[] };
    let hit = (res.results ?? []).find((it) => it.id === itemId) ?? null;
    for (let start = 1, page = 0; !hit && start > 0 && page < 20; page++) {
      const c = await req(`${rest}/content/users/${me}`, { num: 100, start }, 'GET') as { items?: ItemLike[]; nextStart?: unknown };
      hit = (c.items ?? []).find((it) => it.id === itemId) ?? null;
      start = Number(c.nextStart ?? -1);
    }
    return hit;
  }

  const forget = (): void => { table = null; ctx.serviceUrl = null; ctx.newServiceUrl = null; ctx.logItemId = null; };

  const api: NudgeLog = {
    get table() { return table; },
    whoAmI,
    async find() {
      const me = await whoAmI();
      const res = await req(`${rest}/search`, {
        q: `owner:"${me}" AND tags:"${LOG_TAG}" AND type:"Feature Service"`, num: 100, sortField: 'created', sortOrder: 'asc',
      }, 'GET') as { results?: ItemLike[] };
      let mine = (res.results ?? []).filter((it) => isAppLog(it, me));
      // Search is indexed and can lag a new item by minutes; the user's own content list is not. Check it too, so a
      // second run straight after creating the log finds it rather than creating another.
      for (let start = 1, page = 0; !mine.length && start > 0 && page < 20; page++) {
        const c = await req(`${rest}/content/users/${me}`, { num: 100, start }, 'GET') as { items?: ItemLike[]; nextStart?: unknown };
        mine = (c.items ?? []).filter((it) => isAppLog(it, me));
        start = Number(c.nextStart ?? -1);
      }
      // The oldest one is the log; a second would only exist after a race, and is left alone.
      const it = mine[0];
      table = it ? asTable(it, true) : null;
      ctx.serviceUrl = table?.serviceUrl ?? null;
      return table;
    },
    async create() {
      if (table) return (table = await retitle(table));
      const found = await api.find();
      if (found) return (table = await retitle(found));
      const me = await whoAmI();
      const name = `Decluttering_nudge_log_${(opts.random ?? randomHex)()}`;
      const res = await req(`${rest}/content/users/${me}/createService`, {
        outputType: 'featureService',
        title: LOG_TITLE,
        tags: `${LOG_TAG},Decluttering`,
        snippet: LOG_SNIPPET,
        description: LOG_DESCRIPTION,
        createParameters: JSON.stringify({
          name, serviceDescription: LOG_SNIPPET, hasStaticData: false, capabilities: 'Create,Editing,Query',
          maxRecordCount: 2000, supportedQueryFormats: 'JSON',
        }),
      }, 'POST') as { success?: unknown; itemId?: unknown; encodedServiceURL?: unknown; serviceurl?: unknown };
      const url = isLogServiceUrl(res.encodedServiceURL) ? res.encodedServiceURL : isLogServiceUrl(res.serviceurl) ? res.serviceurl : null;
      if (res.success !== true || typeof res.itemId !== 'string' || !url) throw new Error('ArcGIS Online did not create the nudge log');
      ctx.serviceUrl = url; ctx.newServiceUrl = url;
      const def = await req(`${adminUrlOf(url)}/addToDefinition`, { addToDefinition: JSON.stringify(tableDefinition()) }, 'POST');
      ctx.newServiceUrl = null;
      if (def.success !== true) throw new Error('ArcGIS Online did not add the nudge log table');
      table = await retitle({ itemId: res.itemId, title: name, serviceUrl: url, owner: me, access: 'private', reused: false }, true);
      return table;
    },
    async record(row) {
      if (!table) throw new Error('The nudge log is not set up yet');
      const attributes = buildRow(row);
      const res = await req(`${table.serviceUrl}/0/applyEdits`, { adds: JSON.stringify([{ attributes }]), rollbackOnFailure: 'true' }, 'POST') as
        { addResults?: { success?: unknown; objectId?: unknown }[] };
      const r = res.addResults?.[0];
      if (r?.success !== true || typeof r.objectId !== 'number') throw new Error('ArcGIS Online did not add the log row');
      return r.objectId;
    },
    async findAllInOrg() {
      const orgId = opts.orgId.trim();
      const out: LogTable[] = [];
      for (let start = 1, page = 0; start > 0 && page < 20; page++) {
        const res = await req(`${rest}/search`, {
          q: `tags:"${LOG_TAG}" AND type:"Feature Service" AND orgid:${orgId}`, num: 100, start, sortField: 'created', sortOrder: 'asc',
        }, 'GET') as { results?: ItemLike[]; nextStart?: unknown };
        for (const it of res.results ?? []) if (isAppLogAnyOwner(it)) out.push(asTable(it, true));
        start = Number(res.nextStart ?? -1);
      }
      return out;
    },
    async readOthers() {
      const out: OthersRead = { reads: [], unreadable: false };
      try {
        const me = await whoAmI();
        const readOnly = guardedOtherSend(opts.send, portal);
        for (const t of (await api.findAllInOrg()).filter((x) => x.owner !== me)) {
          try {
            const get = async (u: string, p: Record<string, ParamValue>) => unwrap(await readOnly(u, { method: 'GET', params: { f: 'json', ...p } as Record<string, string | number> }));
            out.reads.push({ admin: t.owner, read: readRows(await queryAll(t.serviceUrl, get)) });
          } catch { out.unreadable = true; }
        }
      } catch { out.unreadable = true; }
      return out;
    },
    async read() {
      if (!table) return logRead();
      return readRows(await queryAll(table.serviceUrl, (u, p) => req(u, p, 'GET')));
    },
    async deleteLog() {
      if (!table) throw new Error('The nudge log is not set up yet');
      const t = table;
      const me = await whoAmI();
      const found = await locate(t.itemId, me);
      if (!found) { forget(); return 'gone'; }
      // Still ours? Owner, exact title (or the service name ArcGIS Online gave it), the app's tag, type and service url.
      if (found.id !== t.itemId || found.url !== t.serviceUrl || !isAppLog(found, me)) {
        throw new Error('Refusing to delete: that item is not the app’s own nudge log');
      }
      const prev = ctx.logItemId;
      ctx.logItemId = t.itemId;
      try {
        const r = await req(`${rest}/content/users/${me}/items/${t.itemId}/delete`, {}, 'POST');
        if (r.success !== true) throw new Error('ArcGIS Online did not delete the nudge log');
      } catch (e) {
        ctx.logItemId = prev;
        const x = e as { code?: unknown; message?: unknown };
        if (x.code === 404 || /does not exist|not found/i.test(String(x.message ?? ''))) { forget(); return 'gone'; }
        throw e;
      }
      forget();
      return 'deleted';
    },
  };
  return api;
}

export { LOG_FIELDS, LOG_TITLE, LOG_TAG };
