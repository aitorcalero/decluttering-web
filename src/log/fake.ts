// DC-017: an in-memory fake of the few ArcGIS Online calls the nudge log makes. Used by the demo and the tests; there
// is no network sender here at all. Records each call with ids masked, and parameter names only.
import type { Sender } from '../scan/request';
import { LOG_TAG, LOG_TITLE } from './guard';
import { createNudgeLog, type NudgeLog } from './nudge-log';
import type { LogRead } from './rows';

export const FAKE_PORTAL = 'https://www.arcgis.com';

export interface FakeLogOrgOptions {
  self: string;
  orgId: string;
  /** Start with a log already there. */
  exists?: boolean;
  /** createService ignores the title (the item is titled with the service name), as ArcGIS Online may. */
  titleFromName?: boolean;
  /** Search does not see the new item yet (index lag); only the user's content list does. */
  searchLags?: boolean;
  /** The existing log's title (with `exists`), e.g. its service name. */
  existingTitle?: string;
  /** The item update (retitle) is refused. */
  updateFails?: boolean;
  /** The item delete is refused (e.g. delete-protected). */
  deleteFails?: boolean;
  delayMs?: number;
  /** DC-096: rows already in the log (with `exists`), as the table holds them: owner, sent_at (ms), item_ids, … */
  rows?: Record<string, unknown>[];
}

export interface FakeLogCall { path: string; method: string; params: string[] }
/** A file part sent with a call (ADR 0012): its parameter, type and size, never its bytes. */
export interface FakeUpload { path: string; param: string; type: string; size: number }

interface FakeItem { id: string; title: string; owner: string; access: string; url: string; tags: string[]; type: string }

export function createFakeLogOrg(o: FakeLogOrgOptions) {
  const calls: FakeLogCall[] = [];
  const uploads: FakeUpload[] = [];
  /** The createService parameters as sent (labels: title, tags, snippet, description). */
  const creates: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = (o.rows ?? []).map((r, i) => ({ ...r, OBJECTID: i + 1 }));
  const ITEM = 'e'.repeat(32);
  const svc = (name: string) => `https://services9.arcgis.com/FakeOrg0000000000/arcgis/rest/services/${name}/FeatureServer`;
  let item: FakeItem | null = null;
  let indexed = false;
  let hasTable = false;
  let deleted = 0;
  const make = (name: string, title: string) => {
    item = { id: ITEM, title, owner: o.self, access: 'private', url: svc(name), tags: [LOG_TAG, 'Decluttering'], type: 'Feature Service' };
  };
  if (o.exists) { make('Decluttering_nudge_log_0000beef', o.existingTitle ?? LOG_TITLE); hasTable = true; indexed = true; }
  const wait = () => new Promise<void>((r) => (o.delayMs ? setTimeout(r, o.delayMs) : r()));

  const send: Sender = async (url, r) => {
    const path = url.replace(/^https:\/\/[^/]+/, '').replace(/[0-9a-f]{32}/g, '<id>').replace(/Decluttering_nudge_log_[0-9a-f]{8}/, '<log>');
    calls.push({ path, method: r.method, params: Object.keys(r.params).sort() });
    await wait();
    const p = r.params;
    for (const [k, v] of Object.entries(p)) if (typeof v === 'object' && v !== null && 'size' in v) uploads.push({ path, param: k, type: String((v as Blob).type), size: (v as Blob).size });
    if (url.endsWith('/sharing/rest/portals/self')) return { id: o.orgId, user: { username: o.self } };
    if (url.endsWith('/sharing/rest/search')) return { results: item && indexed ? [item] : [], nextStart: -1 };
    if (url.endsWith(`/sharing/rest/content/users/${o.self}`)) return { items: item ? [item] : [], nextStart: -1 };
    if (url.endsWith('/createService')) {
      creates.push({ ...p });
      const name = String(JSON.parse(String(p.createParameters)).name);
      make(name, o.titleFromName ? name : String(p.title));
      indexed = !o.searchLags;
      return { success: true, itemId: ITEM, name, serviceItemId: ITEM, encodedServiceURL: svc(name), serviceurl: svc(name), type: 'Feature Service' };
    }
    if (url.endsWith(`/items/${ITEM}/update`)) {
      if (o.updateFails || !item) return { error: { code: 500, message: 'Unable to update item' } };
      item.title = String(p.title); return { success: true, id: ITEM };
    }
    if (url.endsWith(`/items/${ITEM}/delete`)) {
      if (o.deleteFails) return { error: { code: 400, message: 'Item is protected from deletion' } };
      if (!item) return { error: { code: 400, message: 'Item does not exist or is inaccessible.' } };
      item = null; hasTable = false; rows.length = 0; deleted++;
      return { success: true, itemId: ITEM };
    }
    if (url.endsWith('/addToDefinition')) { hasTable = true; return { success: true }; }
    if (url.endsWith('/0/applyEdits')) {
      if (!hasTable) return { error: { code: 400, message: 'Invalid URL' } };
      const adds = JSON.parse(String(p.adds)) as { attributes: Record<string, unknown> }[];
      return { addResults: adds.map((a) => { rows.push({ ...a.attributes, OBJECTID: rows.length + 1 }); return { objectId: rows.length, success: true }; }) };
    }
    if (url.endsWith('/0/query')) {
      if (!hasTable) return { error: { code: 400, message: 'Invalid URL' } };
      const fields = String(p.outFields ?? '').split(',').map((f) => f.trim()).filter(Boolean);
      const pick = (a: Record<string, unknown>) => Object.fromEntries(fields.filter((f) => f in a).map((f) => [f, a[f]]));
      return { features: rows.map((a) => ({ attributes: pick(a) })), exceededTransferLimit: false };
    }
    throw new Error(`The fake org doesn't know ${path}`);
  };
  return { send, calls, rows, uploads, creates, /** Something else removes the log (tests): the item is gone from search and the content list. */ removeNow() { item = null; hasTable = false; }, get deleted() { return deleted; }, get item(): FakeItem | null { return item; } };
}

/**
 * DC-096: a nudge log over the fake org, already holding `rows` (the demo's and the simulator's past sends). Reads go
 * through the real log and its allow-list; there is still no network sender.
 */
export function seededNudgeLog(o: { self: string; orgId: string; rows: Record<string, unknown>[] }): NudgeLog {
  const fake = createFakeLogOrg({ self: o.self, orgId: o.orgId, exists: true, rows: o.rows });
  return createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: o.orgId, writableOrgIds: [o.orgId], self: o.self });
}

/** Finds and reads a seeded log: what a scan would read from a real one. */
export async function readSeededLog(o: { self: string; orgId: string; rows: Record<string, unknown>[] }): Promise<LogRead> {
  const log = seededNudgeLog(o);
  await log.find();
  return log.read();
}
