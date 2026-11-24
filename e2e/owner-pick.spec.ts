import { test, expect, type Page } from '@playwright/test';
/* Review: pick any owner in the org; the chart shows all their layers (on the list or not) and the list only theirs. And
 * the line under the chart that says why the shaded zone holds more layers than the list. */
test.setTimeout(120_000);
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

const ready = async (page: Page) => { await expect(page.locator('dc-review [data-card]').first()).toBeVisible({ timeout: 60_000 }); await page.waitForTimeout(800); };
const pick = (page: Page, value: string) => page.locator('[data-action="owner-pick"]').evaluate((sel, v) => {
  (sel as HTMLElement & { value: string }).value = v;
  sel.dispatchEvent(new CustomEvent('calciteSelectChange', { bubbles: true }));
}, value);
const chartOwners = (page: Page) => page.locator('dc-review dc-dot-map').evaluate((m) =>
  [...new Set((m as unknown as { model: { dots: { ownerId?: string }[] } }).model.dots.map((d) => d.ownerId))]);

test('the picker lists every owner; picking one filters the chart to all their layers and the list to theirs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/demo');
  await ready(page);
  const choices = await page.locator('dc-review').evaluate((r) => (r as unknown as { choices(): { username: string; listed: number; total: number }[] }).choices());
  const listedOwners = await page.locator('dc-review [data-card]').count();
  expect(choices.length, 'every owner with a layer, not only those on the list').toBeGreaterThan(listedOwners);
  await expect(page.locator('[data-action="owner-pick"] calcite-option')).toHaveCount(choices.length + 1);
  expect((await chartOwners(page)).length).toBe(choices.length);

  // An owner with nothing on the list: the chart keeps their layers, and the note says how to select them.
  const off = choices.find((c) => c.listed === 0);
  test.skip(!off, 'Every owner in the demo has something on the list.');
  await pick(page, off!.username);
  await expect(page.locator('dc-review [data-card]')).toHaveCount(0);
  await expect.poll(() => chartOwners(page)).toEqual([off!.username]);
  expect(await page.locator('dc-review dc-dot-map').evaluate((m) => (m as unknown as { model: { dots: unknown[] } }).model.dots.length)).toBe(off!.total);
  await expect(page.locator('[data-note="owner-none"]')).toContainText(/none of them meets the rule|doesn’t meet the rule/);
  await expect(page.locator('dc-review .list-head calcite-chip')).toBeVisible();

  // An owner on the list: only their card.
  const on = choices.find((c) => c.listed > 0)!;
  await pick(page, on.username);
  await expect(page.locator('dc-review [data-card]')).toHaveCount(1);
  await expect(page.locator(`dc-review [data-card="${on.username}"]`)).toHaveCount(1);
  await expect(page.locator('[data-note="owner-none"]')).toHaveCount(0);

  // By owner follows the pick; back to all owners.
  await page.locator('dc-review [data-action="chart-view"] calcite-segmented-control-item[value="owner"]').click();
  expect(await page.locator('dc-review dc-sankey').evaluate((s) => (s as unknown as { selected: string | null }).selected)).toBe(on.username);
  await page.locator('dc-review [data-action="chart-view"] calcite-segmented-control-item[value="stale"]').click();
  await pick(page, '');
  await expect(page.locator('dc-review [data-card]')).toHaveCount(listedOwners);
  await expect.poll(() => chartOwners(page).then((o) => o.length)).toBe(choices.length);
});

test('under the chart: how many layers are in the zone, how many on the list, and why the rest are not', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/demo');
  await ready(page);
  // A rule with a long last-used: many layers in the zone have no recorded use, so their last use is unknown.
  await page.locator('dc-review').evaluate((r) => (r as unknown as { setThresholds(t: object): void }).setThresholds({ minDaysSinceUse: 730, minDaysSinceUpdate: 730, maxUsedBy: 0, minSizeMB: 10 }));
  const line = page.locator('[data-zone-line]');
  await expect(line).toBeVisible({ timeout: 10_000 });
  await expect(line).toContainText(/layers? in the shaded zone, \d+ of them on the list\./);
  const head = await line.locator('b').innerText();
  const [zone, listed] = (head.match(/\d+/g) ?? []).map(Number);
  expect(zone).toBeGreaterThan(listed!);
  const cards = await page.locator('dc-review [data-card]').evaluateAll((els) => els.length);
  expect(cards).toBeLessThanOrEqual(listed!);
});
