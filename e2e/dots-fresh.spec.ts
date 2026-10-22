import { test, expect, type Page } from '@playwright/test';

// DC-100c: while Review shows, the hidden scan dot map is not rebuilt; it must be brought up to date the moment the scan screen
// is back. The demo is seeded, so a scan that finishes behind Review must leave exactly the map of one that finishes on screen.
type Summary = { dots: number; exact: boolean; stats: unknown; ids: string };
const summary = (page: Page) => page.evaluate(() => {
  const m = (document.querySelector('dc-dot-map') as unknown as { model?: { dots: { id: string; kind?: string }[]; exact: boolean; stats: unknown } })?.model;
  return m ? { dots: m.dots.length, exact: m.exact, stats: m.stats, ids: m.dots.map((d) => `${d.id}:${d.kind ?? ''}`).sort().join(',') } : null;
}) as Promise<Summary | null>;

test('back on the scan screen after a scan that finished on Review, the dot map matches a scan that finished on screen', async ({ page }) => {
  test.setTimeout(300_000);
  // 1. Finish on the scan screen.
  await page.goto('/#/demo');
  await expect.poll(() => page.evaluate(() => document.title), { timeout: 120_000 }).toMatch(/^Done/);
  const onScreen = await summary(page);
  expect(onScreen?.dots).toBeGreaterThan(0);

  // 2. Open Review mid-scan, let it finish there, then step back to Scan.
  await page.goto('about:blank');
  await page.goto('/#/demo');
  const reviewNow = page.locator('dc-scan-screen [data-action="review"]');
  await expect(reviewNow).toBeVisible({ timeout: 40_000 });
  await reviewNow.click();
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.title), { timeout: 120_000 }).toMatch(/^Done/);
  await page.locator('nav[aria-label="Steps"] [data-step="scan"]').click();
  await expect(page.locator('dc-scan-screen')).toBeVisible();
  await expect.poll(() => summary(page)).toEqual(onScreen);
});
