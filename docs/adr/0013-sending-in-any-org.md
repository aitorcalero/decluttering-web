# ADR 0013: Sending in any org, switched on by each admin inside the app

**Status:** Accepted, 2026-10-22 (user, after a design interview; proposed earlier the same day)

## Context
- The goal is one hosted app that any ArcGIS Online organisation can use, sending included. Asking an org to register its own client ID, or to get a build made for it, is a deal breaker.
- Until now writes were default-deny by org: only org ids listed at build time in `VITE_WRITABLE_ORG_IDS` could create the hidden group, send, or keep the nudge log (DC-058). Owner sends were also behind `VITE_ALLOW_OWNER_SENDS` (DC-019). The public build listed no org, so it was review-only.
- One shipped client ID already works across orgs for sign-in, scan and review: an admin of a second, production org used it read-only without registering anything there.
- Verified in the development org only: a test email to the signed-in admin arrives in about 10 s; the hidden group is created and reused and shows the app's thumbnail; the admin can remove the group and log (ADR 0012).
- Not documented by Esri (desk research, 2026-10-22): any daily or per-call limit on group email notifications, the error when one is hit, the sender identity, or an unsubscribe. An org can restrict members to approved external apps (Organization › Settings › Security: "Members can only sign in to external apps that are approved"; source: doc.arcgis.com/en/arcgis-online/administer/configure-security.htm); the exact error a member sees is not documented. ArcGIS Marketplace is being retired in early 2027, so it is not a distribution route.
- The six-month cooldown used to read only the signed-in admin's own nudge log, and only flagged an owner, never skipped them.

## Decision
1. **Per admin.** Each admin switches sending on for themselves. No admin's choice lets another admin send.
2. **Who:** anyone whose role has the four sending privileges (`portal:admin:viewItems`, `portal:admin:viewUsers`, `portal:user:createGroup`, `portal:admin:assignToGroups`), not only the built-in Administrator role.
3. **The opt-in is the admin's own app group.** Turning sending on creates the hidden group (ADR 0002, 0012); if it exists, that admin is opted in, on any browser or machine. No separate flag, no browser storage.
4. **The flow:** "Turn on sending" (on the access checklist's "Sending in this org" row, and on Emails) → a warm, reassuring confirm (one small hidden group only you can see; nothing is sent until you choose; one friendly email per owner at most every six months; switch it off any time) → "Send yourself a test first" → after a successful test, sending to owners unlocks **for this session**. Every new session asks for one test again, with a friendly one-line reason.
5. **Turning off** removes the group only (the existing ADR 0012 removal). The nudge log stays, so the rest period keeps working; removing the log stays a separate choice in About › App data. "Turn off sending" sits on the checklist row and in About › App data.
6. **Cooldown across admins:** the scan reads every Decluttering nudge log in the org the admin can see (same tag and name pattern, any owner); the app writes only to the admin's own log. An owner nudged by anyone in the last six months rests by default; a deliberate tick still includes them, and the confirm dialog names them ("nudged in the last six months, by you or another admin"). If reading another admin's log turns out not to work, the fallback is plain wording that the app knows only about your own nudges.
7. **Limits set by the app** (ArcGIS documents none): at most 40 owners per send run; at most 100 owner emails per admin per day, counted from the admin's own nudge log; about 2 s between emails; a run stops at the first refusal from ArcGIS, shows its message, how many were sent and who is left, and offers Resume. The numbers are tuned after real use.
8. **Orgs that only allow approved apps:** a failed sign-in shows a friendly explanation ("your organisation may only allow approved apps; ask your ArcGIS Online administrator to approve Decluttering") and links to a short admin guide (About and README). Wording and steps are confirmed against real behaviour before release.
9. **Owner emails** gain no unsubscribe line; admins can add their own words to the template.
10. **One build setting, `VITE_SENDING`:** `off` (review-only everywhere), `list` (only orgs in `VITE_WRITABLE_ORG_IDS` may opt in; development and self-hosting) or `opt-in` (any org may opt in). The opt-in and test-first flow is identical in `list` and `opt-in`. `VITE_ALLOW_OWNER_SENDS` is retired. `off` is also the global kill switch: change the variable, then run the deploy workflow.
11. **Rollout:** build in slices in the private repo, then a development-org trial (first a test member whose email is the developer's own inbox, then one consenting colleague), then a trial in one second org (the first write outside the development org, with the developer's explicit OK), and only then set `VITE_SENDING=opt-in` on the public site. Review-only releases continue meanwhile with sending `off`.

## Consequences
- DC-058's "fail-closed by org list" becomes "fail-closed until this admin has opted in" in `opt-in` mode; the opt-in is a security control and is built and tested as one. The request guards (`src/notify/guard.ts`, `src/log/guard.ts`) stay the only path for writes.
- There is no server: the opt-in, cooldown and limits are enforced by this app in the admin's own browser and org. Someone could email people through ArcGIS Online by other means; the app must not make that easier.
- Copy changes on the access checklist, Emails and About: "switched off here for now" gives way to the opt-in wording, in a reassuring tone.
- The README carries a plain disclaimer (independent project, as is, the admin is responsible for what they send).

## Amendment, 2026-10-23 (user)
- The development-org trial passed with the test member (a real owner send: added, emailed, removed, logged). The user is satisfied with that and **skips the consenting-colleague send and the second-org trial** before switching the public site to `opt-in`.
- In their place: straight after the switch-on, while the site is still unpublicised, the developer opts in on the **live site** in a second org they administer and sends themselves a test. That covers turning sending on outside the org that registered the client ID. Reading another admin's log and the approved-apps behaviour stay UNVERIFIED until seen in use.
- The kill switch is unchanged: set `VITE_SENDING=off` and run the deploy workflow.
- The footer names the site in plain text, not a link: ArcGIS Online refused the link (COM_1132) in the development-org test.
- **Post-switch-on trial passed, 2026-10-23 (user):** on the live site, signed in with a different ArcGIS Online account in a second org, the admin turned sending on and test emails arrived. Turning sending on outside the org that registered the client ID is CONFIRMED.
