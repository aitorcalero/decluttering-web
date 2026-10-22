# 0009 The admin's own browser is the app's cache

**Status:** Accepted, 2026-10-14 (user suggestion). Complements 0001 (browser-only) and 0005 (org footprint).

## Context
Scans of big orgs take minutes, mostly the dependency scan. Repeat visits shouldn't start from zero. "Data stays in the org" rules out any server of ours. The user's own browser is on their machine, so it is allowed, provided it's disclosed.

## Decision
- **localStorage** (under the prefix `decluttering:`) holds settings: chosen thresholds, the dismissed splash, email template edits.
- **IndexedDB** holds the scan cache: item metadata, daily usage and dependency results, keyed by org ID and user. Each part records when it was fetched. On the next visit the app shows cached results at once, marked "from your last scan, 3 days ago", and refreshes in the background. Dependencies are re-checked only for maps and apps modified since the last scan.
- **Expiry:** cache entries older than 7 days are discarded. Signing out offers "Also clear saved data".
- **Disclosure:** the splash, the About page ("What's stored, and where") and the scan footer say that a copy of the scan is kept in this browser only, and offer a **Clear saved data** button.
- Nothing cached is ever sent anywhere. Owner email addresses are not cached; they're fetched at send time.

## Consequences
- Org data (titles, owner names) sits in the browser profile. On a shared computer that matters, which is why expiry and clear-on-sign-out exist.
- DC-016 (scan pipeline) and DC-022 (lazy loading spike) build on this cache. Cache invalidation per item uses `modified`.
- The nudge log (ADR 0005) stays in the org, not the browser, so history follows the org rather than one machine.
