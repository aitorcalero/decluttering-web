/** Friendly sign-in failure text. ADR 0008: an org that restricts sign-in to approved apps may need an admin to approve this one. */
export const APPROVAL_MESSAGE =
  'Sign-in did not complete. If your organisation only allows approved apps, an administrator may need to approve this one first. Ask them to add it, then try again.';

export interface OAuthReturn { error: string; description: string }

/** Reads `?error=...&error_description=...` from an OAuth redirect, or null when there is none. */
export function parseOAuthError(search: string): OAuthReturn | null {
  const p = new URLSearchParams(search);
  const error = p.get('error');
  if (!error) return null;
  return { error, description: p.get('error_description') ?? '' };
}

export function oauthErrorMessage(e: unknown): string {
  const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return detail ? `${APPROVAL_MESSAGE} (${detail})` : APPROVAL_MESSAGE;
}
