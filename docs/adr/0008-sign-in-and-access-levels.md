# 0008 Sign-in with ArcGIS Online credentials, access by privilege

**Status:** Accepted, 2026-10-14 (user decision). Refines DC-015 and DC-032.

## Context
The user wants anyone to open the app and sign in with their ArcGIS Online organisational account. No admin should have to register an app or find a client ID. People without admin rights must still get something useful.

ArcGIS OAuth always needs *some* client ID. "No app registration" therefore means **the project registers one public app** and ships its client ID with the hosted app. It uses PKCE and has no secret. Users never see the ID. Esri's own client IDs (for example the one ArcGIS Online itself uses) are restricted to Esri redirect URIs, so they're not an option.

## Decision
1. **One shipped, public client ID** for the hosted app. Self-hosters register their own, because the redirect URI is theirs; this is documented on the About page. Sign-in uses the user's normal ArcGIS Online login, SSO and MFA included.
2. **Access levels are worked out from privileges, not the role name.** Custom roles exist, so read `portals/self` → `user.privileges` after sign-in and map the result to a mode:

| Mode | Needs (see `docs/research/sign-in-and-privileges.md`; admin set CONFIRMED on the dev org 2026-10-14) | What they get |
|---|---|---|
| **Admin** | `portal:admin:viewItems`, `portal:admin:viewUsers`, `portal:user:createGroup`, `portal:admin:assignToGroups`; usage is detected by a one-day `portals/self/usage` probe (no privilege names it) | Full flow: scan, review, email owners |
| **Admin, can't send** | as Admin but no group creation or notification | Full review; the email step explains what's missing and which privilege to ask for |
| **My items** | any signed-in member | Their own hosted feature services only: the same stale rules, the same why lines and credits. No email step |
| **Can't see usage** | no usage privilege | Rules that need usage are shown as "not available with your access", and the review still works on last updated, used by and size |

3. **Non-admins get a gentle nudge to share the tool.** In My items mode, a friendly panel says: "Your admin can use this to help everyone tidy up." It offers **Copy a note for your admin**: short, pre-written text with the app link. Copying to the clipboard sends nothing. No email is sent from the app in this mode.
4. **If the org restricts sign-in to approved apps:** the failure mode is UNVERIFIED (see the research doc). Catch any OAuth error on return and show a clear page saying an admin may need to approve the app, with the steps once confirmed.

## Consequences
- DC-015 (sign-in and routing) implements this table. Prototype D gets a "My items" variant later.
- DC-032 verifies the exact privilege strings, cross-org sign-in (DC-031) and the approved-apps behaviour, and records the shipped client ID's ownership and hosting domain.
- The About page explains what each access level can do.
