# 0010 Tidy priority: rank stale items simply, with a visual cue

**Status:** Accepted, 2026-10-14. The user suggested it ("large items with low recent use and private to the user should be triaged higher"); the controller designed it. Extends 0007.

## Context
The review lists stale families sorted by credits. A big stale layer that only its owner can see is a much safer and more valuable tidy-up than a small public one that maps use. Both currently look equal apart from their numbers. Admins and owners need to know where to start, at a glance, without another filter to learn.

## Decision
Each stale family gets one of three **tidy priorities**. The rule is simple and every result can be explained in a single line:

| Priority | Rule (all checks use data the scan already has) | Shown as |
|---|---|---|
| **Start here** | Impact is high **and** reach is narrow **and** used by no maps or apps | ●●● plus the label, Boustead Blue |
| **Worth a look** | Anything stale that isn't in the other two | ●●○ plus the label |
| **Low impact** | Impact is low, **or** it's used by maps or apps and shared to the org or public | ●○○ plus the label, neutral grey |

- **Amendment, 2026-10-14 (controller, after the first build):** the first implementation treated "not high impact" as "Low impact", so on Balanced 72 of 103 items were Low and "Worth a look" was nearly empty. **Low impact must mean genuinely small:** credits in the bottom third of the stale set **and** under 0.24 credits a month (1 MB), or zero. Everything between low and high is "Worth a look". Fixed in DC-043.
- **Amendment, 2026-10-15 (user feedback):** "Start here" read as unclear next to its filter chip ("Start here only"). The top tier is now labelled **Quick win** (internal id stays `start`): rows show "Quick win", the chip is "Quick wins only", owner cards say "3 quick wins", and the email heading stays "The quickest wins". The tables and examples below use the old label.
- **Impact:** the family's credits a month are in the top third of the stale set, or ≥ 2.4 credits a month (10 MB), whichever is lower. Relative ranking keeps small orgs meaningful; the absolute floor stops one giant layer from pushing everything else down.
- **Reach:** the source's sharing. *Narrow* means `private`, or `shared` to groups only. *Wide* means `org` or `public`, because others may use it in ways the scan can't see (API scripts, external apps).
- **Never used in the window** (days used = 0) moves "Worth a look" up to "Start here" when impact is high, even if reach is wide, provided it's used by nothing.
- **One plain reason line per priority,** e.g. "Start here: 120 MB, only you can see it, and no one has used it in 90 days." The words follow `docs/tone-of-voice.md`, and it never says "delete": the app suggests a tidy-up, and the owner decides (INTENT).
- **Default sort:** priority, then credits. The list gets a small "Sort: Priority · Credits · Last updated" control. Priority is never a filter by default (no hidden items), though a "Start here only" chip filter is fine.
- **The visual cue is three dots plus text,** never colour alone (WCAG). It sits next to the credits chip on each row. Owner cards show a count, e.g. "3 to start with". The owner email lists "Start here" items first, under the friendly heading "The quickest wins".

## Consequences
- The domain gains `priorityOf(row, staleSet)`, which is pure and tested. Rows gain `priority` and `priorityReason`.
- The prototype (`model.js`) and the app (`src/domain/`) implement the same rule, and the tests mirror each other.
- Thresholds (top third, 2.4 credits) are constants, revisited after the larger-org profile (DC-031).
