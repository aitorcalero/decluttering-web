import { test, expect, type Page } from '@playwright/test';
/* Review's chart zoom: Select | Zoom, a rectangle becomes the view, Back and Show all, and the chart still works inside it. */
test.setTimeout(120_000);
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

const map = (page: Page) => page.locator('dc-review dc-dot-map');
const drawn = (page: Page) => map(page).evaluate((m) => (m as unknown as { sprites: { rad: number }[] }).sprites.filter((s) => s.rad > 0).length);
const drag = async (page: Page, fx0: number, fy0: number, fx1: number, fy1: number) => {
  const b = (await map(page).locator('canvas').boundingBox())!;
  await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500); // the view glides in about a quarter of a second
};

test('Zoom: a rectangle becomes the view, again inside it, and Back and Show all undo it; nothing gets selected', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible({ timeout: 60_000 });
  await map(page).locator('canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const all = await drawn(page);
  await expect(map(page).locator('[data-action="zoom-reset"]')).toHaveAttribute('disabled', '');
  await map(page).locator('[data-scan="tool"] calcite-segmented-control-item[value="zoom"]').click();
  await expect(map(page).locator('[data-scan="zoom-hint"]')).toBeVisible();

  await drag(page, 0.06, 0.55, 0.6, 0.93); // the recently used, recently updated corner
  const one = await drawn(page);
  expect(one).toBeGreaterThan(0);
  expect(one).toBeLessThan(all);
  await expect(map(page).locator('[data-zoom-count]')).toHaveText(new RegExp(`Zoomed in: ${one} layers? in view\\.`));
  expect(await page.locator('dc-review').evaluate((r) => (r as unknown as { delSel: Set<string> }).delSel.size), 'a zoom selects nothing').toBe(0);

  await drag(page, 0.2, 0.2, 0.8, 0.8);
  expect(await drawn(page)).toBeLessThanOrEqual(one);

  await map(page).locator('[data-action="zoom-back"]').click();
  await page.waitForTimeout(500);
  expect(await drawn(page)).toBe(one);
  await map(page).locator('[data-action="zoom-reset"]').click();
  await page.waitForTimeout(500);
  expect(await drawn(page)).toBe(all);
  await expect(map(page).locator('[data-zoom-count]')).toHaveText('');
});

test('inside a zoom, Select still adds what is drawn, and a dot still opens its menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible({ timeout: 60_000 });
  await map(page).locator('canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await map(page).locator('[data-scan="tool"] calcite-segmented-control-item[value="zoom"]').click();
  await drag(page, 0.06, 0.4, 0.7, 0.93);
  const inView = await drawn(page);
  await map(page).locator('[data-scan="tool"] calcite-segmented-control-item[value="select"]').click();
  await drag(page, 0.05, 0.03, 0.98, 0.9); // the whole zoomed plot
  const picked = await page.locator('dc-review').evaluate((r) => (r as unknown as { delSel: Set<string> }).delSel.size);
  expect(picked).toBeGreaterThan(0);
  expect(picked).toBeLessThanOrEqual(inView);
  const b = (await map(page).locator('canvas').boundingBox())!;
  const pt = await map(page).evaluate((m) => { const s = (m as unknown as { sprites: { x: number; y: number; rad: number }[] }).sprites.find((d) => d.rad > 2); return s ? { x: s.x, y: s.y } : null; });
  expect(pt).not.toBeNull();
  await page.mouse.click(b.x + pt!.x, b.y + pt!.y);
  await expect(map(page).locator('.dm-tip [data-dot-action="view"]')).toBeVisible();
});

test('switching to the log scale starts from the whole chart again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible({ timeout: 60_000 });
  await map(page).locator('canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await map(page).locator('[data-scan="tool"] calcite-segmented-control-item[value="zoom"]').click();
  await drag(page, 0.06, 0.4, 0.7, 0.93);
  await expect(map(page).locator('[data-action="zoom-reset"]')).not.toHaveAttribute('disabled', '');
  await map(page).locator('[data-scan="y-scale"] calcite-segmented-control-item[value="log-weeks"]').click();
  await expect(map(page).locator('[data-action="zoom-reset"]')).toHaveAttribute('disabled', '');
  await expect(map(page).locator('[data-zoom-count]')).toHaveText('');
});
