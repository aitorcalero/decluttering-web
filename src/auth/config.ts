/** Build-time sign-in settings (see .env.example). The client ID is public; PKCE has no secret. */
export const CLIENT_ID: string = import.meta.env.VITE_ARCGIS_CLIENT_ID ?? '';
/** Orgs this build may write to (send email through the hidden group). Empty: read-only everywhere (DC-058). */
export const WRITABLE_ORG_IDS: string = import.meta.env.VITE_WRITABLE_ORG_IDS ?? '';
export const PORTAL_URL: string = (import.meta.env.VITE_ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/+$/, '');

/** Redirect back to this app's root, whatever origin and base path it is served from. */
export function redirectUri(loc: Pick<Location, 'origin'> = window.location): string {
  return `${loc.origin}${import.meta.env.BASE_URL}`;
}
