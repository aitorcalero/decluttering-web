import { test, expect, type Page } from '@playwright/test';

// DC-109 (FB-65): the Scan / Review / Emails step indicator. The full demo (not the quick one) has all three steps.
const steps = (page: Page) => page.locator('nav[aria-label="Steps"]');
const step = (page: Page, id: string) => steps(page).locator(`[data-step="${id}"]`);

async function toReview(page: Page) {
  await page.goto('/#/demo');
  await expect(page.locator('[data-action="skip-demo"]')).toBeVisible({ timeout: 40_000 });
  await page.locator('[data-action="skip-demo"]').click();
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible({ timeout: 30_000 });
}

test('Scan, Review, Emails and back, with the ticks kept; Emails is disabled until something is ticked', async ({ page }) => {
  await page.goto('/#/demo');
  await expect(step(page, 'scan')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'emails')).toHaveAttribute('aria-disabled', 'true');
  await toReview(page);
  await expect(step(page, 'review')).toHaveAttribute('aria-current', 'step');
  // The demo opens with some owners already ticked: clear them to see Emails disabled.
  const cards = page.locator('dc-review [data-card]');
  for (let i = 0; i < await cards.count(); i++) {
    const cb = cards.nth(i).locator('calcite-label calcite-checkbox').first();
    if (await cb.evaluate((e) => (e as HTMLInputElement).checked)) await cb.click();
  }
  await expect(page.locator('[data-bar="review"] [data-bar-main]')).toContainText('No one ticked yet');
  await expect(step(page, 'emails')).toHaveAttribute('aria-disabled', 'true');
  await expect(step(page, 'emails')).toHaveAttribute('title', /Tick an owner/);

  await page.locator('dc-review [data-card] calcite-label calcite-checkbox').first().click();
  await expect(page.locator('[data-bar="review"] [data-bar-main]')).toContainText('1 owner ticked');
  await expect(step(page, 'emails')).not.toHaveAttribute('aria-disabled', 'true');

  await step(page, 'emails').click();
  await expect(page).toHaveURL(/#\/demo\/emails$/);
  await expect(step(page, 'emails')).toHaveAttribute('aria-current', 'step');
  await page.locator('#em-intro [data-action="intro-ok"]').click(); // the first-visit note is modal; dismiss it
  await expect(page.locator('#em-intro')).not.toHaveAttribute('open', '');

  await step(page, 'review').click();
  await expect(page).toHaveURL(/#\/demo$/);
  await expect(page.locator('[data-bar="review"] [data-bar-main]')).toContainText('1 owner ticked');

  await step(page, 'scan').click();
  await expect(step(page, 'scan')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('dc-scan-screen')).toBeVisible();
  await step(page, 'review').click();
  await expect(page.locator('[data-bar="review"] [data-bar-main]')).toContainText('1 owner ticked');
});

test('the steps are reachable by keyboard, and Enter on Scan goes back to the scan', async ({ page }) => {
  await toReview(page);
  await step(page, 'scan').focus();
  await expect(step(page, 'scan')).toBeFocused();
  await page.keyboard.press('Tab'); // Review is the current step (not a control), so the next stop is Emails
  await expect(step(page, 'emails')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(step(page, 'scan')).toHaveAttribute('aria-current', 'step');
});

test('at 400 px it shortens to the current step and "step 2 of 3"', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await toReview(page);
  await expect(steps(page).locator('[data-steps-count]')).toHaveText('step 2 of 3');
  await expect(step(page, 'review').locator('.dc-step-label')).toBeVisible();
  const w = await step(page, 'scan').locator('.dc-step-label').evaluate((e) => e.getBoundingClientRect().width);
  expect(w).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the quick demo has no scan to go back to, and the landing page has no steps', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; });
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await expect(step(page, 'scan')).toHaveAttribute('aria-disabled', 'true');
  await expect(step(page, 'review')).toHaveAttribute('aria-current', 'step');
  await page.goto('/#/');
  await expect(steps(page)).toHaveCount(0);
  await page.goto('/#/about');
  await expect(steps(page)).toHaveCount(0);
});
