import { test, expect, type Page } from '@playwright/test';

// DC-113 (FB-69): the short first-visit tour of Review. Automated browsers skip it unless a test opts in with __DC_TOUR__.
const tour = (page: Page) => page.locator('.driver-popover.dc-tour');
const progress = (page: Page) => tour(page).locator('.driver-popover-progress-text');
const mark = (page: Page) => page.evaluate(() => localStorage.getItem('decluttering:tour-review'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __DC_TOUR__?: boolean }).__DC_TOUR__ = true; });
});

/** The full demo plays a scan; "Skip to results" gets to Review. The tour must not appear on the scan screen. */
async function toReview(page: Page) {
  await page.goto('/#/demo');
  await expect(page.locator('[data-action="skip-demo"]')).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1500); // longer than the tour's own delay
  await expect(tour(page)).toHaveCount(0);
  await page.locator('[data-action="skip-demo"]').click();
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible({ timeout: 30_000 });
}

test('opens once on Review; Next and Back move, Skip closes it, and it does not come back', async ({ page }) => {
  await toReview(page);
  await expect(tour(page)).toBeVisible({ timeout: 10_000 });
  await expect(progress(page)).toHaveText(/^1 of [345]$/);
  await expect(tour(page).locator('.driver-popover-title')).toHaveText('How stale is it?');
  await expect(tour(page).getByRole('button', { name: 'Skip tour' })).toBeVisible();
  await expect(tour(page).getByRole('button', { name: /show again/ })).toBeVisible();

  await tour(page).locator('.driver-popover-next-btn').click();
  await expect(progress(page)).toHaveText(/^2 of /);
  await tour(page).locator('.driver-popover-next-btn').click();
  await expect(progress(page)).toHaveText(/^3 of /);
  await tour(page).locator('.driver-popover-prev-btn').click();
  await expect(progress(page)).toHaveText(/^2 of /);

  await page.evaluate(() => window.scrollTo(0, 400));
  await tour(page).getByRole('button', { name: 'Skip tour' }).click();
  await expect(tour(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0); // FB-78
  expect(await mark(page)).toBe('seen');

  // Scan screen and back to Review: it stays closed.
  await page.locator('nav[aria-label="Steps"] [data-step="scan"]').click();
  await expect(page.locator('dc-scan-screen')).toBeVisible();
  await page.locator('nav[aria-label="Steps"] [data-step="review"]').click();
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(tour(page)).toHaveCount(0);
});

test('the last step says Done, and Escape closes it at any step', async ({ page }) => {
  await toReview(page);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // also covers the no-animation path
  await expect(tour(page)).toBeVisible({ timeout: 10_000 });
  const total = Number(/of (\d)$/.exec((await progress(page).textContent()) ?? '')?.[1]);
  expect(total).toBeGreaterThanOrEqual(4);
  const next = tour(page).locator('.driver-popover-next-btn');
  for (let i = 2; i <= total; i++) { await next.click(); await expect(progress(page)).toHaveText(`${i} of ${total}`); }
  await expect(next).toHaveText('Done');
  await page.evaluate(() => window.scrollTo(0, 400));
  await next.click();
  await expect(tour(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0); // FB-78
  expect(await mark(page)).toBe('seen');
});

test('"Don\'t show again" is remembered, and "Show me around" in the user menu opens it again', async ({ page }) => {
  await toReview(page);
  await expect(tour(page)).toBeVisible({ timeout: 10_000 });
  await tour(page).locator('.driver-popover-next-btn').click();
  await tour(page).getByRole('button', { name: /show again/ }).click();
  await expect(tour(page)).toHaveCount(0);
  expect(await mark(page)).toBe('never');

  await page.locator('#dc-user').click();
  await page.locator('[data-action="show-tour"]').click();
  await expect(tour(page)).toBeVisible({ timeout: 10_000 });
  await expect(progress(page)).toHaveText(/^1 of /);
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
  expect(await mark(page)).toBe('never'); // a manual run does not undo "Don't show again"
});

test('the quick demo never shows it by itself', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; });
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(tour(page)).toHaveCount(0);
  expect(await mark(page)).toBeNull();
});
