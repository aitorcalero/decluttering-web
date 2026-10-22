# 0002 Notify owners via a standing hidden group

**Status:** Accepted, 2026-10-10. Endpoint details UNVERIFIED; see `docs/research/agol-notify-usage.md`.

## Context
We want one digest email per owner listing all their flagged items. Item comments (the notebook's approach) are per-item and publicly visible. A browser-only app can't use SMTP. ArcGIS Online's email path is group notify, which only reaches group members.

## Decision
The app creates (once) a hidden, invitation-only group owned by the admin. For each owner: add the owner directly (admins don't need the owner to accept), send one notify with the owner's digest, then remove the owner. Whether someone is notified is decided by the state table (6-month per-owner cooldown), not by group membership. Sending goes through a `Notifier` interface so an SMTP or Azure implementation can be added later.

The research (DC-004) found the call is `POST community/groups/{id}/createNotification`. That's confirmed in the Python API source only. `addUsers` and `removeUsers` are confirmed, at 25 users max per call.

## Consequences
- No SMTP setup, so adoption is easier.
- Each owner costs 3 API calls; a failure partway must be retried idempotently (always attempt the remove).
- The message is rendered as HTML, and links are clickable (confirmed 2026-10-11, DC-012). Recipients aren't told they were added to the group, and multi-recipient notifies don't reveal other addresses.
- If the app crashes between add and remove, an owner can be left in the group. Each run starts by removing any leftover members.
