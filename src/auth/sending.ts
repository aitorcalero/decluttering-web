// ADR 0013: one build setting, VITE_SENDING, says where sending can be switched on. This is the only place that decides
// "may this org opt in". Default deny: unset, empty or anything unrecognised means off. It is a security control.
//   off     no org may opt in (review-only everywhere; also the global kill switch)
//   list    only orgs named in VITE_WRITABLE_ORG_IDS may opt in (development and self-hosting)
//   opt-in  any org may opt in
import { SENDING_MODE_RAW, WRITABLE_ORG_IDS } from './config';
import { writeAllowed } from './write-allowed';

export type SendingMode = 'off' | 'list' | 'opt-in';

/** Exact words only (surrounding spaces ignored). Everything else is `off`. */
export function parseSendingMode(v: unknown): SendingMode {
  if (typeof v !== 'string') return 'off';
  const s = v.trim();
  return s === 'list' || s === 'opt-in' ? s : 'off';
}

/** This build's mode, fixed at build time. */
export const SENDING_MODE: SendingMode = parseSendingMode(SENDING_MODE_RAW);

/** True when an admin in this org may turn sending on. Fails closed on a blank org id or an unknown mode. */
export function orgMayOptIn(orgId: string | null | undefined, mode: SendingMode, list: string | readonly string[] | null | undefined): boolean {
  if (typeof orgId !== 'string' || !orgId.trim()) return false;
  if (mode === 'opt-in') return true;
  if (mode === 'list') return writeAllowed(orgId, list);
  return false;
}

export interface SendingPolicyOverrides {
  /** Overrides VITE_WRITABLE_ORG_IDS (tests only). Given alone, it means `list` mode. */
  writableOrgIds?: string | readonly string[];
  /** Overrides VITE_SENDING (tests only). */
  sendingMode?: SendingMode;
}

/** What the construction guards ask. Without overrides it is this build's mode and list. */
export function mayOptIn(orgId: string | null | undefined, o: SendingPolicyOverrides = {}): boolean {
  const mode = o.sendingMode ?? (o.writableOrgIds !== undefined ? 'list' : SENDING_MODE);
  return orgMayOptIn(orgId, mode, o.writableOrgIds ?? WRITABLE_ORG_IDS);
}

/** This build's answer for a signed-in org (what sign-in records). */
export function buildMayOptIn(orgId: string | null | undefined): boolean {
  return orgMayOptIn(orgId, SENDING_MODE, WRITABLE_ORG_IDS);
}
