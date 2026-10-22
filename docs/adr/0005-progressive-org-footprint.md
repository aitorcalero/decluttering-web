# 0005 Progressive org footprint: read-only until the first real send

**Status:** Accepted, 2026-10-11. Amends 0001 (when the state table is created) and 0002 (cooldown is a flag, not a skip).

## Context
Admins will hesitate to try a tool that creates items in their org. But keeping nudge history over time needs somewhere to write, and the group notify method needs a group. The user wants the app to be non-invasive at first and still useful over repeated runs.

## Decision
The app's writes to the org happen in tiers, each one only when needed and with an explicit, plain-words consent prompt:

1. **Explore (no writes).** Sign-in, scan, review, filters, charts and email preview are read-only. Nothing is created in the org. Most first-time use stops here.
2. **Test send to self.** Creates the hidden admin group (0002), the minimum needed to send any email. Consent prompt names the group and says how to remove it.
3. **First real send.** The admin chooses:
   - **Keep a nudge log (recommended):** creates one private hosted table owned by the admin. Records who was nudged, when, and which items. Powers the "nudged 4 weeks ago" flag.
   - **Send without a log:** nothing else is created. Repeat runs can't flag recent nudges; the app says so.

The info page lists every item the app may create, and how to delete them.

## Consequences
- Adoption friction is limited to the moment of sending, when the value is already visible.
- The scan pipeline and review screens must never depend on the table existing.
- An admin can switch from "no log" to "log" later; history starts from that point.
- A tiny hosted table costs a negligible amount of storage; mention it in the consent prompt anyway.
