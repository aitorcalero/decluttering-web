# ADR 0012: The app's own group and nudge log: labelled, announced, removable by the admin

**Status:** Accepted, 2026-10-21 (user approved the draft in `docs/research/app-data-lifecycle.md` section 5)

## Context
The app creates two things in the admin's org: a hidden notification group (ADR 0002) and a nudge log table (ADR 0005 tier 3). "No delete" protects owners' items. The app's own group and log belong to the admin, who should understand them on sight in ArcGIS Online and be able to remove them. Today the group can be removed (`deleteGroup`), but only offered after a send, and the log can only be deleted outside the app (FB-64).

## Decision
- **Announce:** before creating either one, the app says it will create it and that the admin can remove it later. The copy is in the research doc, section 1.
- **Label:** both get a fixed title, a summary, a description that says what they are and how to remove them, tags, and a thumbnail (PNG: 400×400 for the group, 600×400 for the log). Where possible, the thumbnail goes on a call the app already makes.
- **Remove:** About gains an "App data in your org" section, shown only when the app's group or log exists and the org is writable. Each removal is an explicit click, with a confirm that states its cost.
  - The group removal is the existing `deleteGroup`.
  - The log removal is `POST content/users/{self}/items/{logItemId}/delete`, with no extra params (no `permanentDelete`, no `force`).
- **The rule:** the app may delete only:
  - the group whose id it holds, with the exact title and owner
  - the log item whose id it holds, with the exact title, tag, type and owner, re-checked just before the call

  Never on its own initiative, never on a schedule, never as part of a send.
- **Read-only orgs:** nothing is shown or allowed.

## Consequences
- The guards gain narrow rules in the `retitle` style:
  - log item delete
  - a PNG thumbnail on the existing log update
  - a param check, plus an optional thumbnail, on `createGroup`
  - a thumbnail-only group update as a fallback

  The fetch fence mirrors them.
- Deleting the log loses the cooldown history, so recently nudged owners could be nudged again. The confirm says so plainly, and the button is `kind="danger"`. This weakens "nudge, never nag" only at the admin's explicit request.
- The app can't undo a delete. The ArcGIS Online recycle bin may allow a restore (UNVERIFIED for hosted feature services), but the copy doesn't promise one.
- Groups and logs created before this have no thumbnail until they're recreated, or until the next log update for the log.
- The live checks in research section 6 (multipart thumbnails, service removal on item delete, protection errors) must pass on the dev org before the delete and thumbnail paths ship.
- The `AGENTS.md` guardrail now reads: never deletes, unshares or modifies owners' items; the app's own group and log can be removed by the admin on request.
