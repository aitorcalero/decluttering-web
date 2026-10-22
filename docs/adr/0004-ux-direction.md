# 0004 UX direction: A's staged flow, borrowing from B and C

**Status:** Accepted, 2026-10-11. Inputs: `docs/reviews/2026-10-11-prototype-{a,b,c}.md`.

## Context
Three throwaway prototypes were reviewed. The user preferred A overall, liked B's visible filters, and liked C's owner cards, inactive flags and send animation. All three read as too custom and "AI-generated"; the user wants it to feel familiar to ArcGIS Online.

## Decision
- **Flow:** A's staged flow: scan → review → nudge, with an always-reachable info page (DC-021).
- **Calcite first.** Use Calcite shell, panels, cards, chips, avatars, popovers, tooltips, notices and `calcite-icon` before building anything custom, so it feels familiar to ArcGIS Online users.
- **Boustead (BGG) colours are a strong preference.** The Boustead tokens (DC-002) re-theme Calcite; they don't replace it.
- **Borrow patterns, not looks.** Where Calcite has no answer, take proven patterns from Microsoft Fluent, Google Material and IBM Carbon (e.g. Carbon's data-table and empty-state guidance, Material's motion and state layers, Fluent's progress and notification patterns). Build them in Calcite components and BGG tokens. Never import a second component library.
- **Only stale content.** Owners and items that aren't stale aren't shown. No "nothing stale" cards.
- **Presets fill visible filters.** Gentle / balanced / strict set editable thresholds in a filter panel (B): days since last view, views in the last N days, dependency count, size, owner last sign-in. Each preset states its thresholds in plain words. Every stale item shows a one-line "why".
- **Owner cards (C)** with the user's thumbnail (Calcite avatar). Items use the hosted feature service icon and link to the item in ArcGIS Online. Hovering an item (standard tooltip delay) shows a popover with its key info.
- **Inactive owners are a flag, not a section.** Badge plus "last signed in …". Unticked for email by default; the admin decides.
- **Nudge history is a flag, not a skip.** "Nudged 4 weeks ago" on the owner; unticked by default within 6 months; the admin can override. See 0005 for where history is stored.
- **Credits everywhere.** "Credits potentially reclaimable" appears from the scan onwards, not only at the end. A Sankey chart shows storage credits by owner (top 10, hosted feature services only).
- **Consistent semantic colour.** One set of tokens for stale, at risk, inactive owner and reclaimable, used the same way on every screen. Green never means two things.
- **Email:** A's experience plus C's tone presets and send animation. Group notify renders HTML (confirmed in DC-012), so the template editor is a rich-text editor and item titles link to the item in ArcGIS Online.
- **Disabled actions explain themselves** (tooltip or inline notice).
- **Usage call counts are never shown.**

## Consequences
- Scoring must produce a human-readable reason per item (DC-014).
- Views-over-time and dependencies are slow to fetch; the UI must score on cheap fields first and fill in sparklines and dependency counts lazily (spike: DC-022).
- Tone of voice becomes an INTENT principle; copy needs review as a first-class artefact.
