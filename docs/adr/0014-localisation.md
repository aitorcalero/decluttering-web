# 0014: Localisation (i18n) with a small typed catalogue

## Status
Accepted (phase 1 of a phased migration).

## Context
All user-facing text is English and hard-coded. The app is browser-only, ships as a static site and has a strict CSP, so
anything we add must be small, same-origin and not need a backend.

## Decision
- `src/i18n/` holds a typed message catalogue (`en.ts` is the source of truth, `es.ts` the pilot language) and `t()`, `tn()` (plurals via
  `Intl.PluralRules`) and `Intl`-based number/date helpers. No new dependency.
- English is bundled; other languages are lazy, same-origin chunks. A missing key or a failed chunk falls back to English.
- The language is the saved choice (`decluttering:locale`), else the browser's, else English. `<html lang>` follows it. A picker in the header changes it.
- Messages are whole sentences with `{placeholders}`, never fragments glued together; plural messages use plural forms.
- Domain logic (UTC day arithmetic, rule thresholds, placeholder keys in email templates) does not change with the language.

## Migration
Phase 1: infrastructure and the steps indicator. Later phases move the rest of the UI, then formats and email templates, then tests and docs.
To add a language: create `src/i18n/<code>.ts` with every key of `en.ts`, register it in `LOCALES`, `LOCALE_NAMES` and `loaders` in `src/i18n/index.ts`.
