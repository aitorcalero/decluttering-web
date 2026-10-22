// Builds the real nudge log on a signed-in session. The raw sender stays inside, so the only way to reach it is
// through the log (and so through the log's allow-list). Refuses to exist unless this org may opt in to sending (DC-058, ADR 0013).
import { request } from '@esri/arcgis-rest-request';
import type { ArcGISIdentityManager } from '@esri/arcgis-rest-request';
import { mayOptIn, type SendingMode } from '../auth/sending';
import { WritesDisabled } from '../notify/notifier';
import type { Sender } from '../scan/request';
import { createNudgeLog, type NudgeLog } from './nudge-log';

export interface SessionNudgeLogOptions {
  portal: string;
  orgId: string;
  self?: string;
  writableOrgIds?: string | readonly string[];
  /** Overrides VITE_SENDING (tests only). */
  sendingMode?: SendingMode;
  send?: Sender;
}

export function createSessionNudgeLog(manager: ArcGISIdentityManager | null, o: SessionNudgeLogOptions): NudgeLog {
  if (!mayOptIn(o.orgId, o)) throw new WritesDisabled();
  const send: Sender | undefined = o.send ?? (manager
    ? (url, r) => request(url, { authentication: manager, httpMethod: r.method, params: { f: 'json', ...r.params }, signal: r.signal })
    : undefined);
  if (!send) throw new Error('createSessionNudgeLog needs a session or a sender');
  return createNudgeLog({ send, portal: o.portal, orgId: o.orgId, self: o.self, writableOrgIds: o.writableOrgIds, sendingMode: o.sendingMode });
}
