# ADR 0013: Sending in any org, switched on by that org's admin inside the app

**Status:** Proposed, 2026-10-22 (direction chosen by the user; details to be settled before the build, see "Open questions")

## Context
- The goal is one hosted app that any ArcGIS Online organisation can use, sending included. Asking an org to register its own client ID, or to get a build made for it, is a deal breaker (user, 2026-10-22).
- Today writes are default-deny by org: only org ids listed at build time in `VITE_WRITABLE_ORG_IDS` may create the hidden group, send, or keep the nudge log (DC-058). Owner sends are also behind a second build switch, `VITE_ALLOW_OWNER_SENDS` (DC-019, DC-069). The public build lists no org, so it is review-only.
- One shipped client ID already works across orgs for sign-in, scan and review: it was registered in the dev org and used, read-only, by an admin of a second, production org without registering anything there (user, 2026-10-22).
- Verified so far, in the dev org only: test email to the signed-in admin arrives (about 10 s), the hidden group is created and reused, the group shows the app's thumbnail, and the admin can remove the group and log (ADR 0012). Not yet verified: emails to other people, ArcGIS Online's sending limits, orgs that restrict third-party apps.

## Decision
- **Publish first, review-only.** The first public release keeps today's behaviour. Sending comes in a later release.
- **Per-org opt-in, in the app.** Any org can sign in and review. Sending stays off in an org until its administrator turns it on from inside the app, with a clear confirmation of what will happen (a hidden group, one email per owner, a nudge log in their org).
- **Test first.** After opting in, the admin can only send to themselves until a test has been sent. Real sends keep the existing per-run confirm.
- **No per-org setup.** No client ID, build or configuration per org. The build-time org list stays for development and for self-hosted builds; it no longer decides the public site.
- **Guardrails stay in the app.** "Nudge, never nag" (one digest per owner, six-month cooldown), "no delete", and "data stays in the org" are unchanged. The request guards (`src/notify/guard.ts`, `src/log/guard.ts`) stay the only path for writes.

## Consequences
- DC-058's "fail-closed by org list" becomes "fail-closed until the admin opts in". The opt-in becomes a security control and is designed and tested as one.
- There is no server, so the cooldown and opt-in can only be enforced by this app in the admin's own browser and org. Someone could still email people through ArcGIS Online by other means; the app must not make that easier.
- Copy changes: the access checklist, Emails and About stop saying "switched off here for now" and explain the opt-in instead.
- The README carries a plain disclaimer (independent project, as is, the admin is responsible for what they send).

## Open questions (to settle before the build)
1. Where the opt-in lives: in the org (for example a property on the app's group, or the nudge log) so it follows the admin across browsers, or in this browser only.
2. Who may opt in: any user with the create-groups privilege, or org administrators only.
3. Limits: a daily or per-run cap on owner emails, and what ArcGIS Online itself allows.
4. Turning it off again, and what happens to the group and log then (ADR 0012 removal).
5. What the first real send to someone other than the admin looks like in the dev org, before any other org can send.
6. Orgs that block third-party apps or limit who can approve them: what the app says.
