# Security

Please report security problems privately through GitHub's **Report a vulnerability** (Security › Advisories) on this repository, rather than in a public issue. Include steps to reproduce and what you expected.

## Design

- A browser-only app with no backend. Sign-in is ArcGIS Online OAuth 2.0 with PKCE (a public client, no secret). The token is kept in session storage for the tab, sent in request headers or bodies (never in URLs), and revoked on sign-out.
- Every ArcGIS request passes an allow-list before it is sent:
  - the scan is read-only (`src/scan/guard.ts`)
  - sending allows only the app's own hidden group (`src/notify/guard.ts`)
  - the nudge log allows only the app's own table (`src/log/guard.ts`)
- Writes are refused unless the org is listed in `VITE_WRITABLE_ORG_IDS` at build time. The public build lists none.
- The built site sets a Content Security Policy. Scripts come only from the site (plus the optional Cloudflare beacon), and data goes only to ArcGIS Online.
- The app never deletes, unshares or modifies owners' items. It can remove only its own group and log, and only when you ask (ADR 0012).
