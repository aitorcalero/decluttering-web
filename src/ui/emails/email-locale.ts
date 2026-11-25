// The owner emails' language (Emails step), apart from the app's. Until the admin picks one it follows the app's language.
// In memory only, like the template draft: it lasts until the page reloads.
import { ensureLocale, getLocale, type Locale } from '../../i18n';

let chosen: Locale | null = null;
const listeners = new Set<() => void>();

/** The language owner emails are written in now. */
export const emailLocale = (): Locale => chosen ?? getLocale();

/** The admin picked a language for the emails: load it, then tell subscribers. */
export async function setEmailLocale(locale: Locale): Promise<void> {
  await ensureLocale(locale);
  chosen = locale;
  for (const fn of [...listeners]) fn();
}

/** Subscribe to changes of the email language; returns the unsubscribe function. */
export function onEmailLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests: back to following the app's language. */
export const resetEmailLocale = (): void => { chosen = null; };
