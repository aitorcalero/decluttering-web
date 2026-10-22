// ADR 0013 decision 5 / DC-125e: turning sending off removes the admin's own app group and nothing else. It is the existing
// ADR 0012 removal (removeAppGroup -> notifier.deleteGroup, through the guard), so the nudge log is never touched and the
// six-month rest keeps working. Nothing here sends a request of its own.
import type { GroupNotifier } from '../../notify';
import { TURN_OFF } from './turn-off-copy';
import { removeAppGroup, type AppDataOrg } from '../about/app-data';

export { TURN_OFF };

export type TurnOffOutcome = { ok: true } | { ok: false; message: string; href: string };

export async function turnOffSending(notifier: GroupNotifier, org: AppDataOrg): Promise<TurnOffOutcome> {
  const r = await removeAppGroup(notifier, org);
  return r.ok ? { ok: true } : r;
}
