// DC-017: what the nudge log said, per org, in memory only (it names owners, so it is never stored in the browser).
// Filled at scan time (a read of the app's own table, if there is one) and after each logged send; the review reads it.
// DC-096: a full read (a LogRead) also carries the sends, kept here for the review's "Since your nudges" card.
import type { LoggedSend } from '../domain/types';

const byOrg = new Map<string, Map<string, string>>();
const sendsByOrg = new Map<string, readonly LoggedSend[]>();
const listeners = new Set<() => void>();

/** A plain map (a send shown at once) keeps the sends already known; a full read replaces them. */
export function setNudgeLog(orgId: string, latest: ReadonlyMap<string, string> & { sends?: readonly LoggedSend[] }): void {
  byOrg.set(orgId, new Map(latest));
  if (Array.isArray(latest.sends)) sendsByOrg.set(orgId, [...latest.sends]);
  listeners.forEach((f) => f());
}

/** The org's logged sends (test rows left out), or undefined when no log was read. */
export const getNudgeSends = (orgId: string): readonly LoggedSend[] | undefined => sendsByOrg.get(orgId);

export const getNudgeLog = (orgId: string): ReadonlyMap<string, string> | undefined => byOrg.get(orgId);

/** DC-096: numbers only (no owners) for the scan's finish line, set once a scan and the log read are both in. */
export interface NudgeSummary { counts: { gone: number }; credits: number; exact: boolean }
const summaryByOrg = new Map<string, NudgeSummary | null>();
export function setNudgeSummary(orgId: string, s: NudgeSummary | null): void {
  summaryByOrg.set(orgId, s);
  listeners.forEach((f) => f());
}
export const getNudgeSummary = (orgId: string): NudgeSummary | null => summaryByOrg.get(orgId) ?? null;

/** Calls `f` whenever the log changes. Returns the unsubscribe function. */
export function onNudgeLogChange(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** ADR 0012: the log was deleted, so what it said is gone with it. Drops this org's cached rows and summary. */
export function forgetNudgeLog(orgId: string): void {
  byOrg.delete(orgId); sendsByOrg.delete(orgId); summaryByOrg.delete(orgId);
  listeners.forEach((f) => f());
}

/** Tests only. */
export function clearNudgeLogs(): void { byOrg.clear(); sendsByOrg.clear(); summaryByOrg.clear(); listeners.forEach((f) => f()); }
