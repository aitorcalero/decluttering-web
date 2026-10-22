import { test, expect } from '@playwright/test';

// DC-116: the demo plays a 30 to 45 second scan; this spec only needs the Review page and public/demo/mock-small.json, so it asks for the quick demo.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

test('demo page renders the review with at least one owner, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/#/demo');
  await expect(page.locator('dc-review')).toBeVisible();
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await expect(page.locator('dc-review dc-sankey')).toHaveCount(1);
  await expect(page.locator('.dc-logo .dc-name')).toHaveText('Decluttering');
  expect(errors).toEqual([]);
});
