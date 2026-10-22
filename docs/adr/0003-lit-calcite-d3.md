# 0003 Vite + TypeScript + Lit, Calcite for primitives, D3 for visualisation

**Status:** Accepted, 2026-10-10

## Context
The users are ArcGIS Online admins, who already know Calcite. UX quality is a key requirement, and the app shouldn't look like every other Calcite app.

## Decision
- Lit web components share Calcite's component model, so there's no wrapper layer and the bundle stays small.
- Calcite supplies the primitives (inputs, buttons, dialogs, shell) and accessibility. Brand tokens override Calcite's CSS variables for colour and type.
- Layout and data visualisation are custom: D3 plus modern CSS, progressively enhanced.
- `@esri/arcgis-rest-js` handles auth (PKCE) and REST calls. The full Maps SDK is not needed in v1.

## Consequences
- Fewer off-the-shelf React examples to lean on.
- Custom visualisation must meet accessibility needs itself: text alternatives, keyboard access, and reduced motion.
