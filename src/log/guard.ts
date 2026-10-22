// DC-017: the nudge log's own allow-list (ADR 0005 tier 3). Separate from the scan's read-only guard (unchanged) and the
// notifier's guard. It lists the only calls the log needs; anything else throws before a request:
//  - reads: portals/self, search, the signed-in user's own root content list, and query on the app's own table;
//  - createService: only in the signed-in user's own content, with the app's exact title, tag and service-name shape;
//  - addToDefinition: only on the service this session has just created, and only to add the one table;
//  - applyEdits: adds only (no updates, no deletes), only on the app's own table, only the log's own fields;
//  - retitle (DC-075, ADR 0012): an item update on the app's own log item only, setting only its title, only to LOG_TITLE,
//    and optionally its thumbnail (a PNG of at most 200 KB). ArcGIS Online titles a new service item with its service
//    name, so the title has to be set afterwards; the thumbnail rides on the same call.
//  - deleteLog (ADR 0012): the item delete on the app's own log item only, with no parameters but f. The log module
//    re-verifies the item (owner, title, tag, type, service url) just before it, as the notifier does for the group.
// API facts: docs/research/agol-notify-usage.md, "DC-017".

import { isPngThumbnail, type ParamValue } from '../notify/thumbnail';

export const LOG_TITLE = 'Decluttering nudge log';
/** Tag that marks the app's log item (createService takes `tags`; it documents no typeKeywords). */
export const LOG_TAG = 'decluttering-nudge-log';
/** Service names are unique per org, so each admin's log gets a short random suffix. */
export const LOG_NAME_RE = /^Decluttering_nudge_log_[0-9a-f]{8}$/;
export const LOG_TABLE_NAME = 'nudge_log';

/** The log's fields. No email addresses and no message text, ever. */
export const LOG_FIELDS = ['owner', 'sent_at', 'item_ids', 'item_count', 'credits', 'sender', 'app_version', 'is_test'] as const;
export type LogField = (typeof LOG_FIELDS)[number];

export class BlockedRequest extends Error {
  constructor(what: string, reason: string) {
    super(`BLOCKED (nudge log guard): ${what} - ${reason}`);
    this.name = 'BlockedRequest';
  }
}

export type LogOp = 'portalSelf' | 'search' | 'userContent' | 'createService' | 'addToDefinition' | 'applyEdits' | 'query' | 'retitle' | 'deleteLog';
export const LOG_WRITE_OPS: LogOp[] = ['createService', 'addToDefinition', 'applyEdits', 'retitle', 'deleteLog'];

export interface LogGuardContext {
  /** The portal root, e.g. https://www.arcgis.com. */
  portal: string;
  self: string | null;
  /** The app's own log service (…/FeatureServer), once found or created. */
  serviceUrl: string | null;
  /** Set only for a service this session created: the one addToDefinition may touch. */
  newServiceUrl: string | null;
  /** The app's own log item, once found or created: the only item retitle and deleteLog may touch. */
  logItemId?: string | null;
}

const SERVICE_HOST = /^[a-z0-9-]+\.arcgis\.com$/i;
const SERVICE_PATH = /^\/[A-Za-z0-9]+\/arcgis\/rest\/services\/([A-Za-z0-9_]+)\/FeatureServer$/;

/** True for an https hosted feature service URL whose service name has the app's log shape. */
export function isLogServiceUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.search || u.hash || u.username || u.password || u.port) return false;
  const m = SERVICE_PATH.exec(u.pathname);
  return SERVICE_HOST.test(u.hostname) && !!m && LOG_NAME_RE.test(m[1] ?? '');
}

/** The admin endpoint for a hosted service (CONFIRMED pattern, DC-012): /rest/services/ -> /rest/admin/services/. */
export const adminUrlOf = (serviceUrl: string): string => serviceUrl.replace('/arcgis/rest/services/', '/arcgis/rest/admin/services/');

type Params = Record<string, ParamValue>;
const json = (v: unknown): unknown => { try { return JSON.parse(String(v)); } catch { return undefined; } };
const onlyKeys = (o: object, allowed: readonly string[]) => Object.keys(o).every((k) => allowed.includes(k));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function checkCreate(url: string, p: Params): void {
  if (!onlyKeys(p, ['f', 'outputType', 'createParameters', 'title', 'tags', 'snippet', 'description'])) throw new BlockedRequest(url, 'unexpected createService parameter');
  if (p.outputType !== 'featureService') throw new BlockedRequest(url, 'only a feature service');
  if (p.title !== LOG_TITLE) throw new BlockedRequest(url, "not the app's exact title");
  if (!String(p.tags ?? '').split(',').map((t) => t.trim()).includes(LOG_TAG)) throw new BlockedRequest(url, "missing the app's tag");
  const cp = json(p.createParameters);
  if (!isObj(cp) || typeof cp.name !== 'string' || !LOG_NAME_RE.test(cp.name)) throw new BlockedRequest(url, "not the app's service name");
  if ('layers' in cp || 'tables' in cp) throw new BlockedRequest(url, 'layers and tables are added separately');
}

function checkAddToDefinition(url: string, p: Params): void {
  if (!onlyKeys(p, ['f', 'addToDefinition'])) throw new BlockedRequest(url, 'unexpected addToDefinition parameter');
  const d = json(p.addToDefinition);
  if (!isObj(d) || !onlyKeys(d, ['tables']) || !Array.isArray(d.tables) || d.tables.length !== 1) throw new BlockedRequest(url, 'only the one log table');
  const t = d.tables[0] as Record<string, unknown>;
  const fields = Array.isArray(t?.fields) ? (t.fields as { name?: unknown }[]) : [];
  if (t?.name !== LOG_TABLE_NAME || t?.type !== 'Table') throw new BlockedRequest(url, 'not the log table');
  if (!fields.every((f) => f?.name === 'OBJECTID' || (LOG_FIELDS as readonly string[]).includes(String(f?.name)))) throw new BlockedRequest(url, 'unexpected field');
}

function checkRetitle(url: string, p: Params): void {
  if (!onlyKeys(p, ['f', 'title', 'thumbnail'])) throw new BlockedRequest(url, 'title and thumbnail only');
  if (p.title !== LOG_TITLE) throw new BlockedRequest(url, "not the app's exact title");
  if ('thumbnail' in p && !isPngThumbnail(p.thumbnail)) throw new BlockedRequest(url, 'the thumbnail must be a PNG of 200 KB or less');
}

/** No permanentDelete (the item may go to the recycle bin), no force: nothing but f. */
function checkDeleteLog(url: string, p: Params): void {
  if (!onlyKeys(p, ['f'])) throw new BlockedRequest(url, 'deleting the log takes no parameters');
}

function checkAdds(url: string, p: Params): void {
  if (!onlyKeys(p, ['f', 'adds', 'rollbackOnFailure'])) throw new BlockedRequest(url, 'adds only: no updates or deletes');
  const adds = json(p.adds);
  if (!Array.isArray(adds) || adds.length < 1 || adds.length > 50) throw new BlockedRequest(url, 'adds must be 1 to 50 rows');
  for (const a of adds) {
    if (!isObj(a) || !onlyKeys(a, ['attributes']) || !isObj(a.attributes)) throw new BlockedRequest(url, 'rows carry attributes only');
    if (!onlyKeys(a.attributes, LOG_FIELDS)) throw new BlockedRequest(url, 'unexpected field');
  }
}

const mask = (url: string) => url.replace(/[0-9a-f]{32}/g, '<id>').replace(/\/\/[^/]+\/[A-Za-z0-9]+\/arcgis/, '//<host>/<org>/arcgis');

/** Returns the matched operation, or throws BlockedRequest. Never makes a request. */
export function assertLogAllowed(url: string, method: string, params: Params, ctx: LogGuardContext): LogOp {
  const m = String(method).toUpperCase();
  if (typeof url !== 'string' || !/^https:\/\//.test(url) || /[?#\s\\]|\.\.|%/.test(url)) throw new BlockedRequest(String(url), 'malformed url');
  const base = `${ctx.portal.replace(/\/+$/, '')}/sharing/rest/`;
  if (url.startsWith(base)) {
    const rel = url.slice(base.length);
    if (rel === 'portals/self' && m === 'GET') return 'portalSelf';
    if (rel === 'search' && m === 'GET') return 'search';
    if (ctx.self && rel === `content/users/${ctx.self}` && m === 'GET') return 'userContent';
    if (ctx.self && rel === `content/users/${ctx.self}/createService` && m === 'POST') { checkCreate(mask(url), params); return 'createService'; }
    if (ctx.self && ctx.logItemId && rel === `content/users/${ctx.self}/items/${ctx.logItemId}/update` && m === 'POST') { checkRetitle(mask(url), params); return 'retitle'; }
    if (ctx.self && ctx.logItemId && rel === `content/users/${ctx.self}/items/${ctx.logItemId}/delete` && m === 'POST') { checkDeleteLog(mask(url), params); return 'deleteLog'; }
    throw new BlockedRequest(`${m} ${rel.replace(/[0-9a-f]{32}/g, '<id>')}`, 'not on the nudge log allow-list');
  }
  const svc = ctx.serviceUrl;
  if (!svc || !isLogServiceUrl(svc)) throw new BlockedRequest(mask(url), "no app log table, so no service calls");
  if (url === `${svc}/0/query` && (m === 'GET' || m === 'POST')) return 'query';
  if (url === `${svc}/0/applyEdits` && m === 'POST') { checkAdds(mask(url), params); return 'applyEdits'; }
  if (url === `${adminUrlOf(svc)}/addToDefinition` && m === 'POST') {
    if (ctx.newServiceUrl !== svc) throw new BlockedRequest(mask(url), 'only on a service this session created');
    checkAddToDefinition(mask(url), params);
    return 'addToDefinition';
  }
  throw new BlockedRequest(`${m} ${mask(url)}`, 'not on the nudge log allow-list');
}

const OTHER_QUERY_PARAMS = ['f', 'where', 'outFields', 'returnGeometry', 'orderByFields', 'resultOffset', 'resultRecordCount'] as const;

/**
 * DC-125c (ADR 0013, decision 6): the only call the app may make on another admin's log: a GET query on a service that has
 * the app's log shape. Everything else (applyEdits, addToDefinition, item update or delete, createService, a POST)
 * throws before a request. Own-log reads and all writes stay on assertLogAllowed, which only knows the signed-in admin's log.
 */
export function assertOtherLogReadAllowed(url: string, method: string, params: Params, portal: string): 'query' {
  const m = String(method).toUpperCase();
  if (typeof url !== 'string' || !/^https:\/\//.test(url) || /[?#\s\\]|\.\.|%/.test(url)) throw new BlockedRequest(String(url), 'malformed url');
  if (url.startsWith(`${portal.replace(/\/+$/, '')}/sharing/rest/`)) throw new BlockedRequest(mask(url), "another admin's log: a query only");
  if (m !== 'GET') throw new BlockedRequest(`${m} ${mask(url)}`, "another admin's log: a GET query only");
  if (!url.endsWith('/0/query') || !isLogServiceUrl(url.slice(0, -'/0/query'.length))) throw new BlockedRequest(mask(url), "another admin's log: a query on the app's own table shape only");
  if (!onlyKeys(params, OTHER_QUERY_PARAMS)) throw new BlockedRequest(mask(url), 'unexpected query parameter');
  return 'query';
}
