import { test, expect } from '@playwright/test';

// DC-115 (FB-74): the owner's picture is a link to their content in the admin's org, with a quiet affordance after a short hover or focus.
// The quick demo's mock org has urlKey riverside-studio; one test serves it without. No picture is fetched in the demo (initials show).
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

async function firstLink(page: import('@playwright/test').Page) {
  await page.goto('/#/demo');
  const link = page.locator('dc-owner-list a.owner-pic').first();
  await expect(link).toBeVisible();
  return link;
}

test('the picture links to the owner in the org, in a new tab', async ({ page }) => {
  const link = await firstLink(page);
  const user = await link.getAttribute('data-owner-link');
  expect(await link.getAttribute('href')).toBe(`https://riverside-studio.maps.arcgis.com/home/user.html?user=${encodeURIComponent(user!)}`);
  expect(await link.getAttribute('target')).toBe('_blank');
  expect(await link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(await link.getAttribute('aria-label')).toMatch(/^Open .+'s content in ArcGIS Online/);
});

test('the affordance appears after a short hover', async ({ page }) => {
  const link = await firstLink(page);
  const tip = link.locator('.pic-tip');
  await expect(tip).toHaveCSS('opacity', '0');
  await link.hover();
  await expect(tip).toHaveCSS('opacity', '1', { timeout: 2000 });
  await expect(link.locator('.pic-badge')).toHaveCSS('opacity', '1');
  await expect(tip).toContainText('in ArcGIS Online');
});

test('the affordance appears on keyboard focus', async ({ page }) => {
  const link = await firstLink(page);
  await page.keyboard.press('Tab'); // move into the page, then to the link
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await expect(link.locator('.pic-tip')).toHaveCSS('opacity', '1', { timeout: 2000 });
});

test('with reduced motion it still appears (instantly once the delay has passed)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const link = await firstLink(page);
  await link.hover();
  await expect(link.locator('.pic-tip')).toHaveCSS('opacity', '1', { timeout: 2000 });
});

test('no link without an org urlKey', async ({ page }) => {
  await page.route('**/demo/mock-small.json', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    await route.fulfill({ response: res, json: { ...data, org: { ...data.org, urlKey: '' } } });
  });
  await page.goto('/#/demo');
  await expect(page.locator('dc-owner-list [data-card]').first()).toBeVisible();
  await expect(page.locator('dc-owner-list a.owner-pic')).toHaveCount(0);
});
