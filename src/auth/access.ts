/** Access modes, worked out from privileges (not role names). See docs/adr/0008-sign-in-and-access-levels.md. */
export type AccessMode = 'admin' | 'admin-cant-send' | 'my-items';

/** Needed to review the whole org (CONFIRMED on the dev org, 2026-10-14). */
export const ADMIN_PRIVILEGES = ['portal:admin:viewItems', 'portal:admin:viewUsers'] as const;
/** Needed to notify owners: create the hidden group, then add/remove members. */
export const SEND_PRIVILEGES = ['portal:user:createGroup', 'portal:admin:assignToGroups'] as const;

/**
 * Admin review needs the view privileges. Unreadable org usage does NOT demote an admin: the review still runs
 * on last updated, used by and size, with usage rules marked unavailable (ADR 0008; see canSeeUsage).
 * Sending additionally needs group create and assign. Anything else is My items (least access).
 */
export function accessMode(privileges: string[] | undefined, _usageReadable: boolean): AccessMode {
  const have = new Set(privileges ?? []);
  const has = (list: readonly string[]) => list.every((p) => have.has(p));
  if (!has(ADMIN_PRIVILEGES)) return 'my-items';
  return has(SEND_PRIVILEGES) ? 'admin' : 'admin-cant-send';
}

/** Rules that need usage only apply when the org usage probe succeeded. */
export function canSeeUsage(usageReadable: boolean): boolean {
  return usageReadable;
}

/** DC-111 (FB-67): one line of the sign-in checklist. `neutral` is not a failure (an org that is read-only on purpose). */
export type CapabilityId = 'view' | 'usage' | 'send' | 'org-send' | 'email';
export interface Capability { id: CapabilityId; state: 'yes' | 'no' | 'neutral'; label: string; line: string; /** ADR 0013: the row offers this button. */ action?: 'turn-on' | 'turn-off' }
export type CapabilityLevel = 'full' | 'review' | 'locked' | 'mine';
export interface Capabilities { items: Capability[]; level: CapabilityLevel; summary: string }

export const CAPABILITY_SUMMARY: Record<CapabilityLevel, string> = {
  full: 'You’re all set: full review and sending.',
  review: 'Review only: you can look through the whole org, but not send nudges.',
  locked: 'Review only for now: your account could send, but sending isn’t turned on for you yet.',
  mine: 'Your own layers: we’ll look through the ones you own.',
};

export const SENDING_UNAVAILABLE_LINE = 'Sending isn’t available on this site yet. You can still review everything and write the emails.';

/**
 * What this account can do here, from the same facts sign-in already holds: the privileges, whether the usage probe
 * worked, whether an admin in this org may turn sending on (`mayOptIn`, ADR 0013) and whether this admin has
 * (`optedIn`: their own app group exists; unknown counts as not yet). Pure; no network.
 */
export function capabilities(privileges: string[] | undefined, usageReadable: boolean, mayOptIn: boolean, optedIn = false): Capabilities {
  const on = mayOptIn && optedIn;
  const have = new Set(privileges ?? []);
  const has = (list: readonly string[]) => list.every((p) => have.has(p));
  const view = has(ADMIN_PRIVILEGES), send = has(SEND_PRIVILEGES);
  const items: Capability[] = [
    { id: 'view', state: view ? 'yes' : 'no', label: 'See everyone’s layers',
      line: view ? 'Review the whole org.' : 'You’ll see your own layers only.' },
    { id: 'usage', state: usageReadable ? 'yes' : 'no', label: 'Read how layers are used',
      line: usageReadable ? 'Last used is available.' : 'Last used won’t be available; the other rules still work.' },
    { id: 'send', state: send ? 'yes' : 'no', label: 'Send nudges',
      line: send ? 'You can create the group and add owners to it.' : 'You can review, but sending needs these privileges. Ask an administrator.' },
    { id: 'org-send', state: on ? 'yes' : 'neutral', label: 'Sending in this org',
      line: on ? 'On for you. Send yourself a test first. It goes only to you, so you can see exactly what owners will get.'
        : mayOptIn ? 'Off for you. Turn it on when you’re ready; nothing is sent until you choose.'
        : SENDING_UNAVAILABLE_LINE,
      ...(mayOptIn && !on && send ? { action: 'turn-on' as const } : on ? { action: 'turn-off' as const } : {}) },
  ];
  const level: CapabilityLevel = !view ? 'mine' : send && on ? 'full' : send ? 'locked' : 'review';
  return { items, level, summary: CAPABILITY_SUMMARY[level] };
}

/** DC-121: shown on the checklist and as the test-send block reason. */
export const NO_ADMIN_EMAIL = 'Your ArcGIS Online profile has no email address, so a test has nowhere to go. Add one in your profile, then come back.';

/**
 * DC-121: the "Your email address" row. `undefined` means the address isn't known (not loaded), so there is no row;
 * an empty or blank string means the profile has none.
 */
export function emailCapability(email: string | undefined): Capability | null {
  if (email === undefined) return null;
  const e = email.trim();
  return { id: 'email', state: e ? 'yes' : 'no', label: 'Your email address', line: e || NO_ADMIN_EMAIL };
}

/** The privileges an access mode stands for (sign-in keeps the mode, not the list). */
export function privilegesOfMode(mode: AccessMode): string[] {
  return mode === 'my-items' ? [] : mode === 'admin' ? [...ADMIN_PRIVILEGES, ...SEND_PRIVILEGES] : [...ADMIN_PRIVILEGES];
}
