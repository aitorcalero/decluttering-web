import { test, expect } from '@playwright/test';

// DC-116 (FB-75): the demo plays the real scan on a made-up org of 437 services, then Review, then Emails.
// No sign-in and no network apart from the app's own files. These specs do NOT ask for the quick demo.

type Scan = { services: number; owners: number; stopped: boolean };

test('the demo plays the scan (dot map, stages), can be skipped, and Review shows 437 services; own origin only', async ({ page }) => {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const own = new URL(test.info().project.use.baseURL ?? 'http://localhost:4173').origin;
  // The page's static assets are the one exception, and they are not the demo's: Calcite's icons and strings (js.arcgis.com) and
  // the web fonts load for every page, landing included. Nothing else may leave the origin: no portal, no services, no sign-in.
  const assets = /^https:\/\/(js\.arcgis\.com\/calcite-components\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== own && !assets.test(r.url())) foreign.push(r.url()); });

  await page.goto('/#/demo');
  // The scan screen first: its progress, the dot map and the quiet skip.
  await expect(page.locator('dc-scan-screen [data-scan="progress"]')).toBeVisible();
  await expect(page.locator('dc-scan-screen dc-dot-map')).toBeVisible();
  await expect(page.locator('[data-note="demo-scan"]')).toContainText('437');
  await expect(page.locator('dc-review')).toHaveCount(0);
  // The basics come in after a while: Review now.
  await expect(page.locator('dc-scan-screen [data-action="review"]')).toBeVisible({ timeout: 40_000 });

  await page.locator('[data-action="skip-demo"]').click();
  await expect(page.locator('dc-review')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __scan?: Scan }).__scan?.services), { timeout: 30_000 }).toBe(437);
  const scan = await page.evaluate(() => (window as unknown as { __scan?: Scan }).__scan);
  expect(scan?.stopped).toBe(false);
  expect(scan?.owners).toBeGreaterThan(10);
  // "Since your nudges": the seeded past sends were read.
  await expect(page.locator('dc-review')).toContainText(/nudge/i);

  // Emails works as before, on the fake notifier.
  const cards = page.locator('dc-review [data-card]');
  for (let i = 0; i < await cards.count(); i++) {
    const cb = cards.nth(i).locator('calcite-label calcite-checkbox').first();
    if (!(await cb.evaluate((e) => (e as HTMLInputElement).checked))) await cb.click();
  }
  await expect(page.locator('[data-bar="review"] [data-bar-main]')).toContainText('owners ticked');
  await page.locator('[data-action="to-emails"]').click();
  await expect(page).toHaveURL(/#\/demo\/emails$/);
  await expect(page.locator('#em-intro [data-action="intro-ok"]')).toBeVisible();

  expect(foreign, 'the demo must not call anything outside the app\'s own origin').toEqual([]);
  expect(errors).toEqual([]);
});

test('Review now opens the review while the scan carries on, and Back to the scan returns to it', async ({ page }) => {
  await page.goto('/#/demo');
  const reviewNow = page.locator('dc-scan-screen [data-action="review"]');
  await expect(reviewNow).toBeVisible({ timeout: 40_000 });
  await reviewNow.click();
  await expect(page.locator('dc-review')).toBeVisible();
  await expect(page).toHaveURL(/#\/demo$/);
  await page.locator('[data-action="to-scan"]').click();
  await expect(page.locator('dc-scan-screen dc-dot-map')).toBeVisible();
});
