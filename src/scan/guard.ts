// The read-only guard for the browser scan. Ported from tools/profile-org/guard.mjs (REST rules only).
// An explicit ALLOW-LIST: anything not listed is rejected before a request is made. Several reads use POST
// (portals/self/usage), so each rule carries its own method set. Every scan call goes through guardRequest.
import type { RequestFn } from './types';

const ID32 = '[0-9a-f]{32}';
const ID16 = '[A-Za-z0-9]{16}';
/** An ArcGIS Online username: letters, digits, underscore, dot, at and hyphen (dot-only names are rejected as malformed below). */
const USER = '[A-Za-z0-9_.@-]+';

interface Rule { re: RegExp; methods: string[] }

/** Paths are relative to <portal>/sharing/rest/ and anchored. */
export const REST_ALLOW: Rule[] = [
  { re: /^portals\/self$/, methods: ['GET'] },
  { re: new RegExp(`^portals/(self|${ID16})/users$`), methods: ['GET'] },
  { re: new RegExp(`^portals/(self|${ID16})/usage$`), methods: ['POST'] },
  { re: /^search$/, methods: ['GET'] },
  { re: new RegExp(`^content/items/${ID32}$`), methods: ['GET'] },
  { re: new RegExp(`^content/items/${ID32}/data$`), methods: ['GET'] },
  { re: new RegExp(`^content/items/${ID32}/relatedItems$`), methods: ['GET'] },
  { re: /^community\/self$/, methods: ['GET'] },
  // DC-071a hybrid sizing: an owner's content listing (root, and one folder by its 32-hex id). Reads only.
  { re: new RegExp(`^content/users/${USER}$`), methods: ['GET'] },
  { re: new RegExp(`^content/users/${USER}/${ID32}$`), methods: ['GET'] },
];

export class BlockedRequest extends Error {
  constructor(what: string, reason: string) {
    super(`BLOCKED (read-only guard): ${what} - ${reason}`);
    this.name = 'BlockedRequest';
  }
}

const SERVICE_HOST = /^(services\d*|tiles\d*|features\d*|utility|basemaps\d*|ags)\.arcgis(online)?\.com$|\.arcgisonline\.com$/i;
const SERVICE_PATH = /\/(FeatureServer|MapServer|VectorTileServer|SceneServer|ImageServer|GPServer)(\/|$)|\/rest\/services(\/|$)/i;

/** True for anything that looks like a feature/tile service endpoint (host or path). */
export function isServiceUrl(url: string): boolean {
  let path = url;
  try {
    const u = new URL(url);
    if (SERVICE_HOST.test(u.hostname)) return true;
    path = u.pathname;
  } catch { /* relative path or junk: fall through to the path test */ }
  try { path = decodeURIComponent(path); } catch { return true; }
  return SERVICE_PATH.test(path);
}

/** Throws BlockedRequest unless `path` (relative to sharing/rest) is an allowed read for `method`. */
export function assertAllowed(path: string, method: string = 'GET'): true {
  if (typeof path !== 'string' || !path) throw new BlockedRequest(String(path), 'empty path');
  if (isServiceUrl(path)) throw new BlockedRequest(path, 'feature/tile service url');
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new BlockedRequest(path, 'absolute urls are not allowed');
  if (/[?#%\\\s]|(^|\/)\.\.?(\/|$)|\/\/|^\/|\/$/.test(path)) throw new BlockedRequest(path, 'malformed path');
  const m = String(method).toUpperCase();
  const rule = REST_ALLOW.find((r) => r.re.test(path));
  if (!rule) throw new BlockedRequest(path, 'endpoint is not on the allow-list');
  if (!rule.methods.includes(m)) throw new BlockedRequest(`${m} ${path}`, 'method not allowed for this endpoint');
  return true;
}

/** Wraps a request function so every call is checked first. The inner function is never reached for a blocked call. */
export function guardRequest(inner: RequestFn): RequestFn {
  return async (path, params = {}, options = {}) => {
    const rule = REST_ALLOW.find((r) => r.re.test(path));
    const method = (options.method ?? rule?.methods[0] ?? 'GET').toUpperCase() as 'GET' | 'POST';
    assertAllowed(path, method);
    return inner(path, params, { ...options, method });
  };
}
