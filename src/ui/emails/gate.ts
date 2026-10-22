// DC-019: who may send what, decided in one pure place so the UI only follows it.
//  - "Send a test to me" needs a notifier (a writable org, or the demo's fake) and the create-groups privilege.
//  - Sending to owners additionally needs the build switch VITE_ALLOW_OWNER_SENDS (default off), and only ever
//    happens after the confirm dialog. The demo uses an in-memory fake, so it can show the whole flow.
//  - Defence in depth: the real notifier is wrapped so owner sends throw when the switch is off, whatever the UI does.
import type { GroupNotifier } from '../../notify';
import { READ_ONLY_NOTE } from '../../notify';
import type { NudgeLog } from '../../log';
import { NO_ADMIN_EMAIL } from '../../auth/access';

/** Build-time switch. Anything but the exact string "true" is off. */
export const ALLOW_OWNER_SENDS: boolean = parseAllowFlag(import.meta.env.VITE_ALLOW_OWNER_SENDS);

export function parseAllowFlag(v: unknown): boolean {
  return typeof v === 'string' && v.trim() === 'true';
}

export const OWNER_SENDS_OFF = 'Sending to owners is switched off in this build';

export interface GateInput {
  /** The demo: an in-memory fake notifier, nothing leaves the browser. */
  demo: boolean;
  /** VITE_ALLOW_OWNER_SENDS. */
  allowOwnerSends: boolean;
  /** The org is in VITE_WRITABLE_ORG_IDS (always true in the demo). */
  writable: boolean;
  /** null while the privilege check is still running. */
  canCreate: boolean | null;
  missing?: string;
  owners: number;
  /** DC-121: the signed-in admin's profile email. `undefined` = not known (no block); empty or blank = none (test blocked). */
  adminEmail?: string;
}

export type BlockReason = 'read-only' | 'checking' | 'no-privilege' | 'owner-sends-off' | 'nobody' | 'no-email';
export interface Gate { test: { ok: boolean; reason?: BlockReason; message?: string }; owners: { ok: boolean; reason?: BlockReason; message?: string } }

export function sendGate(g: GateInput): Gate {
  const noPriv = `Your ArcGIS Online role doesn't have ${g.missing || 'the “Create groups” privilege'}, and sending needs one small hidden group.`;
  const base: Gate['test'] = !g.writable && !g.demo ? { ok: false, reason: 'read-only', message: READ_ONLY_NOTE }
    : g.canCreate === null ? { ok: false, reason: 'checking', message: 'Checking your role…' }
    : !g.canCreate ? { ok: false, reason: 'no-privilege', message: noPriv }
    : { ok: true };
  const nobody = g.owners > 0 || !base.ok ? base : { ok: false, reason: 'nobody' as const, message: 'Tick at least one owner first.' };
  // DC-121: only the test goes to the admin, so only the test needs the admin's address.
  const noEmail = base.ok && g.adminEmail !== undefined && !g.adminEmail.trim();
  const test: Gate['test'] = noEmail ? { ok: false, reason: 'no-email', message: NO_ADMIN_EMAIL } : nobody;
  let owners: Gate['owners'] = nobody;
  if (nobody.ok && !g.demo && !g.allowOwnerSends) owners = { ok: false, reason: 'owner-sends-off', message: OWNER_SENDS_OFF };
  return { test, owners };
}

/* ------------------------------------------------------------ the send step: compose -> confirm -> sending */

export type SendStep = 'compose' | 'confirming' | 'sending' | 'done';
export type SendStepEvent = { type: 'ask' } | { type: 'cancel' } | { type: 'confirm' } | { type: 'finished' } | { type: 'again' };

/** Real sends start only from an open confirm dialog, and never while the gate is closed. */
export function nextSendStep(s: SendStep, e: SendStepEvent, gate: Gate): SendStep {
  switch (e.type) {
    case 'ask': return s === 'compose' && gate.owners.ok ? 'confirming' : s;
    case 'cancel': return s === 'confirming' ? 'compose' : s;
    case 'confirm': return s === 'confirming' && gate.owners.ok ? 'sending' : s === 'confirming' ? 'compose' : s;
    case 'finished': return s === 'sending' ? 'done' : s;
    case 'again': return s === 'done' ? 'compose' : s;
  }
}

/* ------------------------------------------------------------ the notifier, with owner sends switched off */

export class OwnerSendsOff extends Error {
  constructor() { super(OWNER_SENDS_OFF); this.name = 'OwnerSendsOff'; }
}

/**
 * Wraps a real notifier: with owner sends off, anything that would put an owner in the group or email them throws
 * before a request. The test send (to the signed-in admin only), group find-or-create and reads still work.
 */
export function gateNotifier(n: GroupNotifier, allowOwnerSends: boolean): GroupNotifier {
  if (allowOwnerSends) return n;
  const off = async (): Promise<never> => { throw new OwnerSendsOff(); };
  return {
    get group() { return n.group; },
    whoAmI: () => n.whoAmI(),
    canCreateGroup: () => n.canCreateGroup(),
    findGroup: () => n.findGroup(),
    createGroup: () => n.createGroup(),
    deleteGroup: () => n.deleteGroup(),
    sendTest: (s, h, f) => n.sendTest(s, h, f),
    add: off,
    remove: (users) => n.remove(users),
    // Removing people only reduces exposure, so tidying is allowed with owner sends off; it never adds anyone.
    tidyGroup: () => n.tidyGroup(),
    async notify(users, subject, message, format) {
      // Only ever the signed-in admin (the test path); anyone else is an owner send.
      const me = await n.whoAmI();
      if (users.length !== 1 || users[0] !== me) throw new OwnerSendsOff();
      return n.notify(users, subject, message, format);
    },
    sendToOwner: off,
  };
}

/* ------------------------------------------------------------ the nudge log, with owner sends switched off (DC-017) */

/**
 * The log is created and written only as part of a real send to owners. With owner sends off, creating it and adding rows
 * throw before a request; finding it and reading it (both reads) still work.
 */
export function gateNudgeLog(l: NudgeLog, allowOwnerSends: boolean): NudgeLog {
  if (allowOwnerSends) return l;
  const off = async (): Promise<never> => { throw new OwnerSendsOff(); };
  return {
    get table() { return l.table; },
    whoAmI: () => l.whoAmI(),
    find: () => l.find(),
    read: () => l.read(),
    // ADR 0012: removing the app's own log only reduces what is in the org, so it stays allowed with owner sends off
    // (like tidyGroup). It is never part of a send; the admin asks for it from About.
    deleteLog: () => l.deleteLog(),
    create: off,
    record: off,
  };
}
