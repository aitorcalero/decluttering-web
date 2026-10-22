# 0006 Brand system: Boustead Geospatial guide on Calcite

**Status:** Accepted, 2026-10-11. Supersedes the teal palette from DC-002. Reference: `docs/branding/boustead-design-system.md`.

## Context
DC-002 took a teal (`#017a64`) and navy from the boustead.sg website. The user has since supplied the official Boustead Geospatial brand guide (August 2025): primary Boustead Blue, secondary Midnight Blue and Amber, three tertiaries, Fira Sans, Roboto and Arial, 8 px rounded corners, a 247.5° angle and a pinstripe graphic. ADR 0004 says Calcite first, with BGG colours as a strong preference.

## Decision
- **Calcite brand = Boustead Blue** `#1b51a3` (hover/press darken toward Midnight). Primary buttons, selected states, links, focus and the app icon tile. It's close to Calcite's own blue, so ArcGIS users feel at home.
- **Midnight Blue:** headings, the app header text, and dark hero bands (scan intro, info page, send celebration).
- **Amber:** the one warm accent. It means "quiet but still used: tidy with care", and highlights. Text on amber is Midnight.
- **Semantic colours** (one meaning each, on every screen):

  | Meaning | Colour | Note |
  |---|---|---|
  | Gone quiet (stale) | Raspberry Red | Solid marks and text, never tinted |
  | Quiet but still used | Amber | Tints allowed |
  | Good outcome (credits reclaimable, sent, tidied) | Pine Green | Never used for anything else |
  | Inactive owner | Midnight Blue | Outline badge |
  | Doing fine / neutral | Calcite neutrals | |

  Glacier Blue is unused (too close to Boustead Blue).
- **Type:**
  - Fira Sans (Light or Regular) for headings and display numbers.
  - **Roboto for all UI text.** The guide names it for digital apps, and it holds up in dense tables. Figtree is dropped.
  - Arial in the owner email template.
- **Shape:** 8 px radius on cards, popovers, dialogs and the icon tile; Calcite's smaller radius stays on inputs and buttons where 8 px looks bloated (UX call; revisit on review). The 247.5° angle is used only as an accent: angled bottom edges on hero bands, and the scan sweep direction.
- **Pinstripe graphic:** not used until the user supplies the asset. It will never be redrawn, rotated or flipped.
- **Dark mode:** brand fills use 40–60% tints of Boustead Blue. Tertiaries appear as solid marks with neutral text.

## Consequences
- `prototypes/shared/tokens.css` is rebased on these values. Prototypes A, B and C change colour too; they're historical and that's acceptable.
- The brand board's icon tiles move from teal to Boustead Blue.
- The tokens move to `src/styles/tokens.css` at scaffold (DC-013) unchanged.
