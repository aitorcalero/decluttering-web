// The blank band under the header on a tall window (seen on an ultrawide, Review > By owner, signed in): Calcite's shell
// spaces its content with justify-content: space-between, and the signed-in app adds a zero-height access dialog next to
// <main>, so a short page was pushed to the bottom. The demo has no access dialog, so the test adds an equivalent sibling.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

test('a short page sits directly under the header on a tall window, even with a zero-height sibling in the shell', async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 1400 });
  await page.goto('/');
  const main = page.locator('calcite-shell > main');
  await expect(main).toBeVisible();
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('data-test', 'zero-height-sibling');
    d.style.height = '0';
    document.querySelector('calcite-shell')!.insertBefore(d, document.querySelector('calcite-shell > main'));
  });
  const headerBottom = await page.locator('calcite-shell > calcite-navigation').evaluate((e) => e.getBoundingClientRect().bottom);
  const mainTop = await main.evaluate((e) => e.getBoundingClientRect().top);
  expect(mainTop - headerBottom).toBeLessThan(4);
});
