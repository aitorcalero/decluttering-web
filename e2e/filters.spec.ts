// DC-084: each dc-filters control changes the thresholds dc-review evaluates (demo mode, no network).
// Expected counts are worked out from the demo data with the same domain functions the app uses.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRESETS, PRESET_NAMES, evaluate, matchPreset, ruleLine, sizeChangeImpact, sweepsOf } from '../src/domain/stale';
import { sweepNote, sweepSummary } from '../src/domain/sweep';
import { suggest } from '../src/domain/suggest';
import type { Data, Thresholds } from '../src/domain/types';
import { quickWinsOnly, selectionOf, sumSvc } from '../src/ui/review/helpers';
import { credit } from '../src/ui/shared/text';

// DC-116: the demo plays a 30 to 45 second scan; this spec only needs the Review page and public/demo/mock-small.json, so it asks for the quick demo.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

// DC-087: the demo mock (public/demo/mock-small.json) carries lastViewed and numViews itself.
const data = JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo/mock-small.json'), 'utf8')) as Data;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
/** The list heading dc-review shows for these thresholds. */
const headingOf = (t: Thresholds): string => {
  const ev = evaluate(data, t);
  return ev.owners.length ? `${plural(ev.owners.length, 'owner', 'owners')} · ${plural(ev.totals.services, 'service', 'services')}` : 'Nothing to review';
};
const sug = suggest(data);
const START: Thresholds = sug ? sug.thresholds : PRESETS.balanced;

const heading = (p: Page) => p.locator('dc-review .list-head h2');
const ctx = (p: Page) => p.locator('dc-review #summary-h .ctx');
const select = (p: Page, label: string) => p.locator(`dc-filters calcite-select[label="${label}"] select`);
const pickPreset = (p: Page, name: string) => p.locator(`dc-filters calcite-segmented-control-item[value="${name}"]`).click();

async function open(page: Page) {
  await page.goto('/#/demo');
  await expect(heading(page)).toBeVisible();
}

test('the demo opens on Suggested (or Balanced) and the heading matches evaluate()', async ({ page }) => {
  await open(page);
  await expect(heading(page)).toHaveText(headingOf(START));
  await expect(ctx(page)).toHaveText(`· ${sug ? 'Suggested' : 'Balanced'}`);
});

test('each preset button applies its numbers, wording and counts', async ({ page }) => {
  await open(page);
  for (const name of ['gentle', 'balanced', 'strict'] as const) {
    await pickPreset(page, name);
    await expect(ctx(page)).toHaveText(`· ${PRESET_NAMES[name]}`);
    await expect(heading(page)).toHaveText(headingOf(PRESETS[name]));
    await expect(page.locator('dc-filters p.words')).toHaveText(ruleLine(PRESETS[name]));
  }
});

test('changing each control re-evaluates the list with that value, and the starting point becomes Custom', async ({ page }) => {
  await open(page);
  await pickPreset(page, 'balanced');
  let t: Thresholds = { ...PRESETS.balanced };
  const steps: [string, keyof Thresholds, number][] = [
    ['Last used', 'minDaysSinceUse', 90],
    ['Last updated', 'minDaysSinceUpdate', 90],
    ['Used by', 'maxUsedBy', 0],
    ['Last used', 'minDaysSinceUse', 365],
    ['Minimum size', 'minSizeMB', 20], // raising the size never asks
  ];
  const seen = new Set<string>([headingOf(t)]);
  for (const [label, key, value] of steps) {
    await select(page, label).selectOption(String(value));
    t = { ...t, [key]: value };
    await expect(heading(page), `${label} -> ${value}`).toHaveText(headingOf(t));
    await expect(ctx(page)).toHaveText(`· ${PRESET_NAMES[matchPreset(t)]}`);
    await expect(page.locator('dc-filters p.words')).toHaveText(ruleLine(t));
    seen.add(headingOf(t));
  }
  expect(seen.size, 'the demo data should move the count at least once').toBeGreaterThan(1);
});

test('lowering the size below the starting point asks first; Keep leaves the list, Include applies it', async ({ page }) => {
  await open(page);
  await pickPreset(page, 'strict');
  const adds = sizeChangeImpact(data, PRESETS.strict, 0).families;
  test.skip(adds === 0, 'the demo has no services under 10 MB');
  const dlg = page.locator('dc-filters #small-dlg');
  await select(page, 'Minimum size').selectOption('0');
  await expect(dlg).toHaveAttribute('open', '');
  await dlg.locator('calcite-button', { hasText: 'Keep the 10 MB minimum' }).click();
  await expect(heading(page)).toHaveText(headingOf(PRESETS.strict));
  await expect(select(page, 'Minimum size')).toHaveValue('10');

  await select(page, 'Minimum size').selectOption('0');
  await dlg.locator('calcite-button', { hasText: 'Include small items' }).click();
  await expect(heading(page)).toHaveText(headingOf({ ...PRESETS.strict, minSizeMB: 0 }));
  await expect(ctx(page)).toHaveText('· Custom');
});

test('"Quick wins only": the heading, figures and action bar count only the visible items; turning it off restores them (DC-085)', async ({ page }) => {
  await open(page);
  // These numbers give some owners a Quick win and others none.
  const T: Thresholds = { minDaysSinceUse: 90, minDaysSinceUpdate: 90, maxUsedBy: 1, minSizeMB: 0 };
  await pickPreset(page, 'balanced');
  await select(page, 'Minimum size').selectOption('0');
  const dlg = page.locator('dc-filters #small-dlg');
  const asked = await expect(dlg).toHaveAttribute('open', '', { timeout: 1500 }).then(() => true, () => false);
  if (asked) await dlg.locator('calcite-button', { hasText: 'Include small items' }).click();
  await expect(ctx(page)).toHaveText('· Custom');
  for (const [label, value] of [['Last used', T.minDaysSinceUse], ['Last updated', T.minDaysSinceUpdate], ['Used by', T.maxUsedBy]] as const) {
    await select(page, label).selectOption(String(value));
  }
  await expect(heading(page)).toHaveText(headingOf(T));
  const ev = evaluate(data, T);
  const quick = quickWinsOnly(ev.owners);
  expect(quick.length, 'fixture: some owners have Quick wins').toBeGreaterThan(0);
  expect(quick.length, 'fixture: some owners have none').toBeLessThan(ev.owners.length);
  const sel = selectionOf(quick, new Map());
  const barText = (n: { owners: string[]; services: number; credits: number }) => n.owners.length
    ? `${plural(n.owners.length, 'owner', 'owners')} ticked · ${plural(n.services, 'service', 'services')} in their digests · ≈ ${credit(n.credits)} credits a month`
    : 'No one ticked yet';
  const bar = page.locator('[data-bar-main]');
  const before = await bar.textContent();
  const toggle = page.locator('dc-review .list-tools calcite-button', { hasText: 'Quick wins only' });
  await toggle.click();
  await expect(page.locator('dc-review [data-card]')).toHaveCount(quick.length);
  await expect(heading(page)).toHaveText(`${plural(quick.length, 'owner', 'owners')} · ${plural(quick.reduce((n, o) => n + sumSvc(o.rows), 0), 'service', 'services')}`);
  await expect(bar).toHaveText(barText(sel));
  expect(await bar.textContent()).not.toBe(before);
  await toggle.click();
  await expect(heading(page)).toHaveText(headingOf(T));
  await expect(bar).toHaveText(before ?? '');
});

test('the Custom button keeps the current numbers, and the summary and starting point both say Custom (DC-085)', async ({ page }) => {
  await open(page);
  await pickPreset(page, 'balanced');
  await pickPreset(page, 'custom');
  await expect(heading(page)).toHaveText(headingOf(PRESETS.balanced));
  await expect(ctx(page)).toHaveText('· Custom');
  await expect(page.locator('dc-filters p.words')).toHaveText(ruleLine(PRESETS.balanced));
  await expect(page.locator('dc-filters calcite-segmented-control-item[value="custom"]')).toHaveAttribute('checked', '');
  await pickPreset(page, 'strict');
  await expect(ctx(page)).toHaveText('· Strict');
});

// DC-086: a script that touched most layers on one day, injected into the demo data; the note names the date, and "Count them" brings the light touches back in.
test('a sweep day: the note names it, and Count them / Set them aside move the list (DC-086)', async ({ page }) => {
  // Injected into the demo mock, whose services already carry lastViewed.
  let hit = 0;
  const swept: Data = { ...data, services: data.services.map((s) => {
    const free = !s.usage.some(([d]) => d === 3);
    return free && hit < 60 ? (hit++, { ...s, usage: [...s.usage, [3, 1] as [number, number]].sort((a, b) => a[0] - b[0]) }) : s;
  }) };
  const d = swept;
  const s = sweepSummary(sweepsOf(d), Date.parse(d.org.scannedAt));
  expect(s, 'fixture: the injected day is a sweep').not.toBeNull();
  const off = evaluate(d, PRESETS.balanced).totals.families, on = evaluate(d, PRESETS.balanced, { countSweeps: true }).totals.families;
  expect(off, 'fixture: setting the touches aside changes the list').toBeGreaterThan(on);
  await page.route('**/demo/mock-small.json', (r) => r.fulfill({ json: swept }));
  await page.goto('/#/demo');
  await expect(heading(page)).toBeVisible();
  await pickPreset(page, 'balanced');
  const note = page.locator('dc-review [data-note="sweeps"]');
  await expect(note).toContainText(sweepNote(s!, false).text);
  const b = PRESETS.balanced;
  const head = (countSweeps: boolean) => {
    const ev = evaluate(d, b, { countSweeps });
    return ev.owners.length ? `${plural(ev.owners.length, 'owner', 'owners')} · ${plural(ev.totals.services, 'service', 'services')}` : 'Nothing to review';
  };
  await expect(heading(page)).toHaveText(head(false));
  await note.locator('[data-action="count-sweeps"]', { hasText: 'Count them' }).click();
  await expect(note).toHaveAttribute('data-counting', 'true');
  await expect(note).toContainText(sweepNote(s!, true).text);
  await pickPreset(page, 'balanced');
  await expect(heading(page)).toHaveText(head(true));
  await note.locator('[data-action="count-sweeps"]', { hasText: 'Set them aside' }).click();
  await pickPreset(page, 'balanced');
  await expect(heading(page)).toHaveText(head(false));
});

test('the plain demo has no sweep, so no note (DC-086)', async ({ page }) => {
  expect(sweepSummary(sweepsOf(data), Date.parse(data.org.scannedAt))).toBeNull();
  await open(page);
  await expect(page.locator('dc-review [data-note="sweeps"]')).toHaveCount(0);
});
