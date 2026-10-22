# ADR 0011: Close the loop: show what happened since a nudge

**Status:** Accepted, 2026-10-17 (user chose it as the next feature)

## Context
Admins nudge owners, then have no way to see whether it worked. The nudge log (ADR 0002, DC-017) already records, per real send, the owner, time, item ids and the estimated credits a month, in the admin's own org.

## Decision
- On each scan, the app reads the log's sends (GET only, non-test rows, in memory only because it names owners) and gives each nudged item one outcome against today's scan, first match wins: **no longer in your org**, **handed over** (owner changed), **updated** (modified after the send), **used again** (last used after the send, sweep-aware), **no change yet**. Unknowns in a partial scan are **not checked**.
- Credits saved a month: per send, the logged credits × (items gone / items in the send), labelled "about"; exact when all are gone. The table schema doesn't change.
- Shown as a calm card on Review and a short clause on the scan's finish line; never "because of your nudge" (correlation, not cause).
- No log (send without a log, read-only org, nothing sent): nothing is shown or claimed.

## Consequences
- Works only for admins who keep the log; the log-choice copy can now say what it buys ("so we can show what happened since").
- Per-item credits are approximate when a send is partly resolved. A per-item size field could fix this later, at the cost of a schema change for existing tables.
- Built as DC-096.
