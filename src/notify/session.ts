// Builds the real group notifier on a signed-in session. The raw sender stays inside this function, so the only way
// to reach it is through the notifier (and so through the notifier's allow-list).
import { request } from '@esri/arcgis-rest-request';
import type { ArcGISIdentityManager } from '@esri/arcgis-rest-request';
import { createGroupNotifier, WritesDisabled, type GroupNotifier } from './notifier';
import { WRITABLE_ORG_IDS } from '../auth/config';
import { writeAllowed } from '../auth/write-allowed';
import type { Sender } from '../scan/request';
import type { RequestFn } from '../scan/types';

export interface SessionNotifierOptions {
  portal: string;
  self?: string;
  /** The signed-in org's id; the notifier refuses to exist unless it is writable (DC-058). */
  orgId: string;
  /** Overrides VITE_WRITABLE_ORG_IDS (tests only). */
  writableOrgIds?: string | readonly string[];
  /** Injected in tests and dry runs; defaults to arcgis-rest-js with the session. */
  send?: Sender;
}

export function createSessionNotifier(manager: ArcGISIdentityManager | null, opts: SessionNotifierOptions): GroupNotifier {
  // Checked before anything else is built, so a read-only org never gets a sender either.
  if (!writeAllowed(opts.orgId, opts.writableOrgIds ?? WRITABLE_ORG_IDS)) throw new WritesDisabled();
  const base = `${opts.portal.replace(/\/+$/, '')}/sharing/rest`;
  const send: Sender | undefined = opts.send ?? (manager
    ? (url, o) => request(url, { authentication: manager, httpMethod: o.method, params: { f: 'json', ...o.params }, signal: o.signal })
    : undefined);
  if (!send) throw new Error('createSessionNotifier needs a session or a sender');
  const raw: RequestFn = (path, params = {}, options = {}) =>
    send(`${base}/${path}`, { method: options.method ?? 'GET', params, signal: options.signal });
  return createGroupNotifier({ request: raw, self: opts.self, orgId: opts.orgId, writableOrgIds: opts.writableOrgIds });
}
