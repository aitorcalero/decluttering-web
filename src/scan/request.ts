// The app's only REST seam. Everything the scan sends goes through guardRequest (allow-list, no writes).
import { request } from '@esri/arcgis-rest-request';
import type { ArcGISIdentityManager } from '@esri/arcgis-rest-request';
import { guardRequest } from './guard';
import type { RequestFn, RequestOptions } from './types';

/** What actually sends a call. Injected in tests; defaults to arcgis-rest-js. */
export type Sender = (url: string, o: { method: 'GET' | 'POST'; params: Record<string, string | number>; signal?: AbortSignal }) => Promise<unknown>;

export interface CreateRequestOptions {
  portal: string;
  /** My items mode: only this user's services are searched, and the user list is just this user. */
  ownerOnly?: string;
  /** When false the usage endpoint is not called (the account cannot read it); usage comes back empty. */
  usageReadable?: boolean;
  send?: Sender;
}

const SERVICE_SEARCH = /type:"Feature Service"/;

function restSender(manager: ArcGISIdentityManager): Sender {
  return (url, o) => request(url, { authentication: manager, httpMethod: o.method, params: { f: 'json', ...o.params }, signal: o.signal });
}

/** Builds the scan's RequestFn: session-authenticated and always guarded. */
export function createRequest(manager: ArcGISIdentityManager | null, opts: CreateRequestOptions): RequestFn {
  const base = `${opts.portal.replace(/\/+$/, '')}/sharing/rest`;
  const send = opts.send ?? (manager ? restSender(manager) : undefined);
  if (!send) throw new Error('createRequest needs a session or a sender');
  const { ownerOnly, usageReadable = true } = opts;

  const inner: RequestFn = async (path, params = {}, options: RequestOptions = {}) => {
    const method = options.method ?? 'GET';
    let p = params;
    if (ownerOnly && path === 'search' && typeof p.q === 'string' && SERVICE_SEARCH.test(p.q)) {
      p = { ...p, q: `${p.q} AND owner:${ownerOnly}` };
    }
    const res = await send(`${base}/${path}`, { method, params: p, signal: options.signal });
    return options.text && typeof res !== 'string' ? JSON.stringify(res) : res;
  };

  const guarded = guardRequest(inner);

  // Pre-guard shims for the two org-wide endpoints a plain member cannot read.
  return async (path, params, options) => {
    if (path === 'portals/self/usage' && !usageReadable) return { data: [] };
    if (path === 'portals/self/users' && ownerOnly) {
      const me = await guarded('community/self', {}, { signal: options?.signal }) as { username?: string; fullName?: string; role?: string };
      return { users: [{ username: me.username ?? ownerOnly, fullName: me.fullName ?? ownerOnly, role: me.role }], total: 1, nextStart: -1 };
    }
    return guarded(path, params, options);
  };
}
