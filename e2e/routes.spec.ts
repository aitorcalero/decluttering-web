import { test, expect } from '@playwright/test';

// DC-116: the demo plays a 30 to 45 second scan; this spec only needs the Review page and public/demo/mock-small.json, so it asks for the quick demo.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

test('landing page offers sign-in and the demo, and the demo route works', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('[data-page="landing"]')).toBeVisible();
  await expect(page.locator('[data-action="sign-in"]')).toBeVisible();
  await expect(page.locator('[data-action="demo"]')).toBeVisible();

  await page.locator('[data-action="demo"]').click();
  await expect(page).toHaveURL(/#\/demo$/);
  await expect(page.locator('dc-review')).toBeVisible();
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('an OAuth error on return shows the approval message', async ({ page }) => {
  await page.goto('/?error=access_denied&error_description=nope');
  await expect(page.locator('[data-page="error"]')).toContainText('approve');
});

test('the app route without a session goes back to the landing page', async ({ page }) => {
  await page.goto('/#/app');
  await expect(page.locator('[data-page="landing"]')).toBeVisible();
});

test('demo: review -> write the emails -> test to me -> confirm -> send, with retry (fake notifier, no network)', async ({ page }) => {
  const errors: string[] = [];
  const arcgis: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (/arcgis\.com\/sharing/.test(r.url())) arcgis.push(r.method()); });

  await page.goto('/#/demo');
  const cards = page.locator('dc-review [data-card]');
  await expect(cards.first()).toBeVisible();
  // Tick every owner so the run has two (the demo's second owner stalls once, to show "Try again").
  for (let i = 0; i < await cards.count(); i++) {
    const cb = cards.nth(i).locator('calcite-label calcite-checkbox').first();
    if (!(await cb.evaluate((e) => (e as HTMLInputElement).checked))) await cb.click();
  }
  await expect(page.locator('[data-bar="review"] [data-bar-main]')).toContainText('2 owners ticked');
  await page.locator('[data-action="to-emails"]').click();
  await expect(page).toHaveURL(/#\/demo\/emails$/);

  await page.locator('#em-intro [data-action="intro-ok"]').click();
  await expect(page.locator('[data-preview="subject"]')).toContainText('of your ArcGIS items could use a quick look');
  await expect(page.locator('[data-preview="body"] a').first()).toHaveAttribute('href', /\.maps\.arcgis\.com\/home\/item\.html\?id=/);

  // Test to me: the consent dialog comes first (the group doesn't exist yet), then the test goes out.
  await page.locator('[data-action="test"]').click();
  await page.locator('#em-consent [data-action="consent-yes"]').click();
  await expect(page.locator('[data-toast]')).toContainText('Nobody else got it');

  // Real send only after the confirm dialog, which states the count.
  await page.locator('[data-action="send"]').click();
  await expect(page.locator('#em-confirm [data-confirm]')).toContainText('2 owners will each get one email');
  // DC-017: this run sends without a log (the nudge-log flow has its own test below).
  await page.locator('#em-confirm [data-log-option="none"]').click();
  await page.locator('#em-confirm [data-action="confirm-send"]').click();
  // DC-068: the run starts by tidying leftovers out of the group (the demo seeds two).
  await expect(page.locator('[data-tidy="done"]').first()).toContainText('Tidied the group: 2 people left over from an earlier run were taken out.');
  await expect(page.locator('[data-run-state="finished"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-run][data-phase="failed"]')).toHaveCount(1);
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('[data-done="2"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-live]')).toContainText('2 owners have their email');
  await expect(page.locator('[data-done-log="none"]')).toBeVisible();

  await page.locator('#done-back').click();
  await expect(page).toHaveURL(/#\/demo$/);
  await expect(page.locator('[data-bar="review"] [data-bar-main]')).toContainText('2 owners ticked');
  expect(arcgis).toEqual([]);
  expect(errors).toEqual([]);
});

test('demo: the first real send asks about the nudge log; choosing it creates it, and later runs show "nudged today" (DC-017)', async ({ page }) => {
  const errors: string[] = [];
  const arcgis: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (/arcgis\.com\/sharing|FeatureServer/.test(r.url())) arcgis.push(r.method()); });

  await page.goto('/#/demo');
  const cards = page.locator('dc-review [data-card]');
  await expect(cards.first()).toBeVisible();
  const before = await page.locator('dc-review [data-card] .c-nudged').count();
  expect(before).toBeLessThan(await cards.count());
  for (let i = 0; i < await cards.count(); i++) {
    const cb = cards.nth(i).locator('calcite-label calcite-checkbox').first();
    if (!(await cb.evaluate((e) => (e as HTMLInputElement).checked))) await cb.click();
  }
  await page.locator('[data-action="to-emails"]').click();
  await page.locator('#em-intro [data-action="intro-ok"]').click();

  // First real send: the confirm dialog asks, with the log as the recommended choice.
  await page.locator('[data-action="send"]').click();
  await expect(page.locator('#em-confirm [data-log-choice="log"]')).toContainText('Keep a nudge log (recommended)');
  await expect(page.locator('#em-confirm [data-confirm]')).toContainText('No email addresses or message text');
  await page.locator('#em-confirm [data-action="confirm-send"]').click();
  await expect(page.locator('[data-log-setup="done"]').first()).toContainText('Created your private nudge log');
  await expect(page.locator('[data-run-state="finished"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('[data-done="2"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-done-log="kept"]')).toContainText('2 sends were noted in your private nudge log');

  // A later run: the review flags both owners, and an owner left unticked rests as "nudged today".
  await page.locator('#done-back').click();
  await expect(page).toHaveURL(/#\/demo$/);
  await expect(page.locator('dc-review [data-card] .c-nudged')).toHaveCount(2);
  const first = cards.nth(0).locator('calcite-label calcite-checkbox').first();
  if (await first.evaluate((e) => (e as HTMLInputElement).checked)) await first.click();
  const second = cards.nth(1).locator('calcite-label calcite-checkbox').first();
  if (!(await second.evaluate((e) => (e as HTMLInputElement).checked))) await second.click();
  await page.locator('[data-action="to-emails"]').click();
  await page.locator('#em-intro [data-action="intro-ok"]').click();
  await expect(page.locator('.em-owner .em-why').first()).toContainText('Nudged today');
  // The log is found, not created again.
  await page.locator('[data-action="send"]').click();
  await expect(page.locator('#em-confirm [data-log-choice="log"]')).toContainText('Add to your nudge log');
  await page.locator('#em-confirm [data-action="confirm-send"]').click();
  await expect(page.locator('[data-log-setup="reuse"]').first()).toContainText('Adding to your private nudge log');
  expect(arcgis).toEqual([]);
  expect(errors).toEqual([]);
});

test('demo: "Send without a log" is remembered for the next send (DC-017)', async ({ page }) => {
  await page.goto('/#/demo');
  const cards = page.locator('dc-review [data-card]');
  await expect(cards.first()).toBeVisible();
  // Tick every owner so the run has two (DC-083: under the last-used rule the demo's second owner, who stalls once, was
  // nudged recently and starts unticked).
  for (let i = 0; i < await cards.count(); i++) {
    const cb = cards.nth(i).locator('calcite-label calcite-checkbox').first();
    if (!(await cb.evaluate((e) => (e as HTMLInputElement).checked))) await cb.click();
  }
  await page.locator('[data-action="to-emails"]').click();
  await page.locator('#em-intro [data-action="intro-ok"]').click();
  await page.locator('[data-action="send"]').click();
  await page.locator('#em-confirm [data-log-option="none"]').click();
  await page.locator('#em-confirm [data-action="confirm-send"]').click();
  // The demo's second owner stalls once.
  await expect(page.locator('[data-run-state="finished"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('[data-done-log="none"]')).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('decluttering:nudgeLogChoice:')).map((k) => localStorage.getItem(k)))).toEqual(['none']);
  // Next time (a fresh Emails step) the remembered answer is preselected, and can be changed.
  await page.locator('#done-back').click();
  await page.locator('[data-action="to-emails"]').click();
  await page.locator('#em-intro [data-action="intro-ok"]').click();
  await page.locator('[data-action="send"]').click();
  await expect(page.locator('#em-confirm [data-log-choice="none"]')).toBeVisible();
  await page.locator('#em-confirm [data-log-option="log"]').click();
  await expect(page.locator('#em-confirm [data-log-choice="log"]')).toBeVisible();
});

test('the emails route without a session goes back to the landing page', async ({ page }) => {
  await page.goto('/#/emails');
  await expect(page.locator('[data-page="landing"]')).toBeVisible();
});
