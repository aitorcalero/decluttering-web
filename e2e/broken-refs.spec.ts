import { test, expect } from '@playwright/test';

// DC-035a: the playing demo scans a made-up org with 3 maps and apps that point at deleted layers (and a decoy that must not
// show). Review lists them in a collapsed block under the owner list. The quick demo (no scan) shows nothing.

test('the playing demo lists maps and apps with missing layers, without calling any service url', async ({ page }) => {
  const errors: string[] = [];
  const urls: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => urls.push(r.url()));

  await page.goto('/#/demo');
  await expect(page.locator('dc-scan-screen [data-action="review"]')).toBeVisible({ timeout: 40_000 });
  await page.locator('[data-action="skip-demo"]').click();
  await expect(page.locator('dc-review')).toBeVisible({ timeout: 30_000 });

  const block = page.locator('dc-broken-refs calcite-block[data-broken-refs="block"]');
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(block).toHaveAttribute('heading', 'Maps and apps with missing layers (3)');
  expect(await block.evaluate((el) => (el as HTMLElement & { open: boolean }).open)).toBe(false); // collapsed
  await block.evaluate((el) => { (el as HTMLElement & { open: boolean }).open = true; });
  const rows = block.locator('li[data-broken]');
  await expect(rows).toHaveCount(3);
  await expect(block).toContainText("points at a layer that's no longer in your org");
  await expect(block).toContainText('Flood Watch Viewer');
  await expect(block).not.toContainText('Regional Overview Map');

  // Report only: nothing here to tick or send.
  await expect(block.locator('calcite-checkbox, calcite-button')).toHaveCount(0);
  // The scan never asks a service url for anything (the made-up org answers from memory, and there is no other network).
  expect(urls.filter((u) => /arcgis\.com\/.*\/rest\/services\/|FeatureServer|MapServer/i.test(u) && !/js\.arcgis\.com\/calcite/.test(u))).toEqual([]);
  expect(errors).toEqual([]);
});

test('the quick demo shows no missing-layers block', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; });
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await expect(page.locator('dc-broken-refs calcite-block')).toHaveCount(0);
});
