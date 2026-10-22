# 0001 Browser-only SPA, no backend

**Status:** Accepted, 2026-10-10

## Context
The app reads other organisations' ArcGIS Online content. Storing that data on our side raises privacy and security obligations. Typical orgs have ~1k hosted feature services from ~50 owners; the largest we're targeting have ~5k from ~150.

## Decision
A static SPA that talks directly to ArcGIS Online REST with the admin's OAuth2 PKCE token. State (notification history, cooldowns, audit) lives in an app-created private hosted table in the admin's own org.

## Consequences
- Hosting is free or cheap (any static host), there are no secrets to manage, and nothing is persisted outside the customer's org.
- Scans run while the tab is open; per-item usage calls must be throttled and shown as progress.
- There are no scheduled or unattended runs; the notebook remains for that.
- Email is limited to what ArcGIS Online can send (see 0002). An SMTP option would need a backend; deferred.
