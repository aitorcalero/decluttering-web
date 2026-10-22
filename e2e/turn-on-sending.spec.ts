import { test, expect, type Page } from '@playwright/test';

// ADR 0013 / DC-125a: "Turn on sending" is a warm, deliberate confirm. It opens on the safe choice ("Not now"), and the
// hidden group is created only on "Turn on sending". Demo mode only: an in-memory fake, no network, nothing is sent.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

const active = (page: Page) => page.evaluate(() => {
  let el: Element | null = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) { if (el.matches('[data-focus], [data-action]')) break; el = el.shadowRoot.activeElement; }
  const host = (el as Element | null)?.closest?.('[data-focus]') ?? el;
  return host ? `${host.tagName.toLowerCase()}${host.getAttribute('data-action') ? '[' + host.getAttribute('data-action') + ']' : ''}` : '';
});

async function openEmails(page: Page) {
  const arcgis: string[] = [];
  page.on('request', (r) => { if (/arcgis\.com\/sharing/.test(r.url())) arcgis.push(r.url()); });
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await page.locator('[data-action="to-emails"]').click();
  await page.locator('#em-intro [data-action="intro-ok"]').click();
  return arcgis;
}

test('the dialog opens on "Not now", has the agreed copy, and creates nothing until "Turn on sending"', async ({ page }) => {
  const arcgis = await openEmails(page);
  await page.locator('[data-action="test"]').click();
  const dialog = page.locator('#turn-on-dialog');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog).toHaveAttribute('heading', 'Turn on sending for you?');
  await expect(dialog.locator('li')).toHaveText([
    'You’re in control. Nothing is sent until you choose.',
    'We’ll set up one small hidden group in your org that only you can see.',
    'Each owner gets one friendly email, at most once every six months.',
    'You can switch it off any time.',
  ]);
  await expect(dialog.locator('[data-action="turn-on-yes"]')).toHaveText('Turn on sending');
  await expect(dialog.locator('[data-action="turn-on-no"]')).toHaveText('Not now');
  await expect.poll(() => active(page)).toContain('[turn-on-no]');

  // Not now: closes, and no group was created.
  await dialog.locator('[data-action="turn-on-no"]').click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-setup]')).toHaveCount(0);

  // Turn on sending: the group is created, and the next step is gentle.
  await page.locator('[data-action="test"]').click();
  await expect(dialog).toHaveAttribute('open', '');
  await dialog.locator('[data-action="turn-on-yes"]').click();
  await expect(page.locator('[data-setup]')).toHaveCount(1);
  await expect(page.locator('[data-toast]')).toContainText('Send yourself a test first. It goes only to you, so you can see exactly what owners will get.');
  expect(arcgis).toEqual([]);
});

test('Escape also counts as "Not now"', async ({ page }) => {
  await openEmails(page);
  await page.locator('[data-action="test"]').click();
  const dialog = page.locator('#turn-on-dialog');
  await expect(dialog).toHaveAttribute('open', '');
  await expect.poll(() => active(page)).toContain('[turn-on-no]'); // focus is in the dialog before Escape
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-setup]')).toHaveCount(0);
});
