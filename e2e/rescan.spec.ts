import { test, expect, type Page } from '@playwright/test';

/*
 * DC-105 (FB-62): Rescan on Review. On the dev simulator (fast, so the scan finishes in seconds): a large org warns first
 * with a time, a small one just starts; Not now does nothing and returns focus to the button; Rescan runs a full scan and
 * the review's ticks survive. The simulator is dev-server only, so this spec uses the dev server on 5173 and skips itself
 * when that isn't running. The warning's time comes from the last full scan, so the large case pretends that took 25 minutes
 * (the dev-only localStorage key `decluttering:fullScanMs`).
 */
const DEV = 'http://localhost:5173';
test.use({ baseURL: DEV });
test.beforeAll(async () => {
  const up = await fetch(DEV).then((r) => r.ok, () => false);
  test.skip(!up, 'Needs the dev server (npm run dev): the simulator is not in the preview build.');
});
test.setTimeout(240_000);

async function openReview(page: Page, hash: string, fullScanMs?: number): Promise<void> {
  if (fullScanMs) await page.addInitScript((ms) => localStorage.setItem('decluttering:fullScanMs', String(ms)), fullScanMs);
  await page.goto(`/${hash}`);
  const screen = page.locator('dc-scan-screen section[data-page="app"]');
  await expect(screen).toHaveAttribute('data-flow', 'done', { timeout: 180_000 });
  await page.locator('dc-scan-screen [data-action="review"]').click();
  await expect(page.locator('app-review [data-scan-state], [data-scan-state]').first()).toHaveAttribute('data-scan-state', 'done');
}

test('large org: the warning gives a time; Not now does nothing; Rescan runs a full scan and ticks survive', async ({ page }) => {
  await openReview(page, '#/simulate?n=7000&speed=0.02', 1_500_000);
  const button = page.locator('[data-action="rescan"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('label', /Rescan .+: read every layer, map and app again/);

  // Tick an owner so we can see it survive.
  const cb = page.locator('dc-review [data-card]').first().locator('calcite-label calcite-checkbox').first();
  await cb.click();
  const ticked = await cb.evaluate((e) => (e as HTMLInputElement).checked);

  // The warning: org name, the time, the two buttons.
  await button.click();
  const dialog = page.locator('calcite-dialog[data-dialog="rescan"]');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog).toContainText('This reads every layer, map and app again: about 25 minutes, based on your last full scan.');
  await expect(dialog).toContainText('You can keep using Review while it runs.');
  await expect(dialog.locator('[data-action="rescan-go"]')).toHaveText('Rescan');
  await expect(dialog.locator('[data-action="rescan-cancel"]')).toHaveText('Not now');

  // Not now: closes, nothing starts, focus is back on the button.
  await dialog.locator('[data-action="rescan-cancel"]').click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-scan-state]').first()).toHaveAttribute('data-scan-state', 'done');
  await expect(button).toBeFocused();

  // Rescan: a full scan runs on the review, then finishes; the tick is still there.
  await button.click();
  await dialog.locator('[data-action="rescan-go"]').click();
  await expect(button).toHaveCount(0); // hidden while it runs
  await expect(page.locator('[data-note="cache"]')).toContainText('Freshly scanned just now', { timeout: 180_000 });
  expect(await cb.evaluate((e) => (e as HTMLInputElement).checked)).toBe(ticked);
  // Done: the simulator still offers it (dev only; a real org hides it for a day).
  await expect(button).toBeVisible();
});

test('small org: Rescan starts without asking', async ({ page }) => {
  await openReview(page, '#/simulate?n=200&speed=0.02');
  const button = page.locator('[data-action="rescan"]');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('calcite-dialog[data-dialog="rescan"][open]')).toHaveCount(0);
  await expect(page.locator('[data-note="cache"]')).toContainText(/still checking|Freshly scanned/);
  await expect(page.locator('[data-note="cache"]')).toContainText('Freshly scanned just now', { timeout: 120_000 });
});
