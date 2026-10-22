import { test, expect } from '@playwright/test';

// A11Y-04: Emails dialogs open on a useful (safe) control, and the first-visit dialog hands focus to the page heading.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

const active = (page: import('@playwright/test').Page) => page.evaluate(() => {
  let el: Element | null = document.activeElement;
  // Calcite controls keep focus inside their own shadow root: name the host that holds it.
  while (el && el.shadowRoot && el.shadowRoot.activeElement) { if (el.matches('[data-focus], [data-action], #email-h, calcite-input')) break; el = el.shadowRoot.activeElement; }
  const host = (el as Element | null)?.closest?.('[data-focus], #email-h') ?? el;
  return host ? `${host.tagName.toLowerCase()}${host.id ? '#' + host.id : ''}${host.getAttribute('data-action') ? '[' + host.getAttribute('data-action') + ']' : ''}` : '';
});

test('the first-visit dialog opens on "Got it" and, closed with Escape, leaves focus on the Emails heading', async ({ page }) => {
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible(); // owners start ticked
  await page.locator('[data-action="to-emails"]').click();
  await expect(page.locator('#em-intro [data-action="intro-ok"]')).toBeVisible();
  await expect.poll(() => active(page)).toContain('[intro-ok]');
  await page.keyboard.press('Escape');
  await expect.poll(() => active(page)).toBe('h1#email-h');
});

test('Add a link opens on the web address field', async ({ page }) => {
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await page.locator('[data-action="to-emails"]').click();
  await page.locator('#em-intro [data-action="intro-ok"]').click();
  await page.locator('.em-editor').click();
  await page.locator('calcite-button[label="Link"]').click();
  await expect(page.locator('#em-link-url')).toBeVisible();
  await expect.poll(() => active(page)).toContain('calcite-input#em-link-url');
});
