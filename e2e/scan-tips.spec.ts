import { test, expect } from '@playwright/test';

// DC-118 (FB-77): "While you wait" tips appear for any scan expected to take a minute or more, first in the side column.

// The simulator is dev-server only, so these use the dev server on 5173 and skip when it isn't running.
const DEV = 'http://localhost:5173';
test.use({ baseURL: DEV });
test.beforeAll(async () => {
  const up = await fetch(DEV).then((r) => r.ok, () => false);
  test.skip(!up, 'Needs the dev server (npm run dev): the simulator is not in the preview build.');
});
test.setTimeout(90_000);

test('a long scan shows the tips at the top of the side column, in view at 1280x720', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/#/simulate?n=7000&speed=1');
  const tips = page.locator('dc-scan-screen [data-scan="wait"]');
  await expect(tips).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('dc-scan-screen .side > *').first()).toHaveAttribute('data-scan', 'wait');
  // With the access checklist dismissed (it is tall), the whole card is in the first screen.
  await page.getByRole('button', { name: 'Dismiss the access checklist' }).click();
  await page.waitForTimeout(800);
  const box = await tips.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
});

test('reduced motion: the tips card has no transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/#/simulate?n=7000&speed=1');
  const tips = page.locator('dc-scan-screen [data-scan="wait"]');
  await expect(tips).toBeVisible({ timeout: 60_000 });
  expect(await tips.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s(, 0s)*$/);
});
