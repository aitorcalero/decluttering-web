import { test, expect } from '@playwright/test';

/*
 * DC-102 (FB-60): a stopped scan shows how far it really got and can be resumed in the same session. Runs on the dev
 * simulator (1,500 layers, so sizes and maps are read in the background); the review's ticks survive the round trip.
 * The simulator is dev-server only (the Playwright preview build drops it), so this spec uses the dev server on 5173 and
 * skips itself when that isn't running.
 */
const DEV = 'http://localhost:5173';
test.use({ baseURL: DEV });
test.beforeAll(async () => {
  const up = await fetch(DEV).then((r) => r.ok, () => false);
  test.skip(!up, 'Needs the dev server (npm run dev): the simulator is not in the preview build.');
});

test.setTimeout(240_000);
test('stop, see an honest percent, resume from the review link, ticks survive, ends done', async ({ page }) => {
  await page.goto('/#/simulate?n=1500&speed=1');
  const screen = page.locator('dc-scan-screen section[data-page="app"]');
  await expect(screen).toHaveAttribute('data-flow', 'background', { timeout: 90_000 });

  // Review now, tick an owner, then stop from the review.
  await page.locator('dc-scan-screen [data-action="review"]').first().click();
  const cb = page.locator('dc-review [data-card]').first().locator('calcite-label calcite-checkbox').first();
  const before = await cb.evaluate((e) => (e as HTMLInputElement).checked);
  await cb.click();
  const after = await cb.evaluate((e) => (e as HTMLInputElement).checked);
  expect(after).toBe(!before);
  await page.locator('[data-scan="background"] [data-action="stop"]').click();

  // The review offers Resume while the scan is stopped and unfinished, with the percent it really reached.
  const link = page.locator('[data-note="stopped"] [data-action="resume-link"]');
  await expect(link).toBeVisible();
  const label = (await link.textContent()) ?? '';
  const pct = Number(/stopped at (\d+)%/i.exec(label)?.[1]);
  expect(pct).toBeLessThan(99);

  // The scan screen says the same, and offers Resume scan and See results.
  await page.locator('a.dc-home').click();
  await expect(page.locator('dc-scan-screen [data-scan="meta"]')).toContainText(`Stopped at ${pct}%`);
  await expect(page.locator('dc-scan-screen [data-action="resume"]')).toBeVisible();
  await expect(page.locator('dc-scan-screen [data-action="review"]')).toBeVisible();

  // Resume from the review link: back on the scan screen, scanning, and it ends done (100%).
  await page.locator('dc-scan-screen [data-action="review"]').click();
  await link.click();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(screen).toHaveAttribute('data-flow', /scanning|background/);
  await expect(screen).toHaveAttribute('data-flow', 'done', { timeout: 150_000 });
  await expect(page.locator('dc-scan-screen [data-scan="meta"]')).toContainText('100%');
  await expect(page.locator('dc-scan-screen [data-action="resume"]')).toHaveCount(0);

  // The link is gone from the review, and the tick is still there.
  await page.locator('dc-scan-screen [data-action="review"]').click();
  await expect(page.locator('[data-note="stopped"]')).toHaveCount(0);
  // (the summary totals can move as more maps and apps are read; the person's own choice does not)
  expect(await cb.evaluate((e) => (e as HTMLInputElement).checked)).toBe(after);
});
