import { test, expect, type Page } from '@playwright/test';

// DC-125d: the limits on sending, seen in the demo. The demo has only a couple of owners, so a test hook
// (window.__DC_DEMO_LIMITS__) lowers the limits there; it can never raise them (see limits.test.ts).
async function toEmails(page: Page, limits: Record<string, number>) {
  await page.addInitScript((l) => {
    const w = window as unknown as { __DC_DEMO_FAST__?: boolean; __DC_DEMO_LIMITS__?: Record<string, number> };
    w.__DC_DEMO_FAST__ = true;
    w.__DC_DEMO_LIMITS__ = l;
  }, limits);
  await page.goto('/#/demo');
  const cards = page.locator('dc-review [data-card]');
  await expect(cards.first()).toBeVisible();
  for (let i = 0; i < await cards.count(); i++) {
    const cb = cards.nth(i).locator('calcite-label calcite-checkbox').first();
    if (!(await cb.evaluate((e) => (e as HTMLInputElement).checked))) await cb.click();
  }
  await page.locator('[data-action="to-emails"]').click();
  await page.locator('#em-intro [data-action="intro-ok"]').click();
}

test('over the per-run limit: a calm note, the button and the confirm say how many go now, the rest stay ticked', async ({ page }) => {
  await toEmails(page, { perRun: 1, gapMs: 0 });
  await expect(page.locator('[data-note="send-limit"]')).toContainText('You can send to up to 1 owners at a time. Send these, then start another run for the rest.');
  await expect(page.locator('[data-action="send"]')).toContainText('Send to 1 owner');
  await page.locator('[data-action="send"]').click();
  await expect(page.locator('#em-confirm [data-confirm]')).toContainText('1 owner will each get one email');
  await expect(page.locator('#em-confirm [data-confirm-limit]')).toContainText('start another run for the rest');
  await page.locator('#em-confirm [data-log-option="none"]').click();
  await page.locator('#em-confirm [data-action="confirm-send"]').click();
  await expect(page.locator('[data-run]')).toHaveCount(1);
  await expect(page.locator('[data-done="1"]')).toBeVisible({ timeout: 20_000 }); // one owner went, not both
});

test('at the daily limit: the send button is off, with the reason', async ({ page }) => {
  await toEmails(page, { perDay: 0 });
  await expect(page.locator('[data-action="send"]')).toHaveAttribute('disabled', /.*/);
  await expect(page.locator('[data-note="send-limit"]')).toContainText('the most that can go in a day');
});
