import { test, expect, type Page } from '@playwright/test';

/*
 * DC-103 (FB-53): when every owner the rule flags is the signed-in admin, Review says there is no one to nudge, shows the
 * admin's own to-do list (item links, credits, Mark as done) and has no ticks and no Emails step. Runs on the dev simulator
 * (`solo=1`: one member who owns everything), which is dev-server only, so it uses the dev server on 5173 and skips itself
 * when that isn't running.
 */
const DEV = 'http://localhost:5173';
test.use({ baseURL: DEV });
test.beforeAll(async () => {
  const up = await fetch(DEV).then((r) => r.ok, () => false);
  test.skip(!up, 'Needs the dev server (npm run dev): the simulator is not in the preview build.');
});
test.setTimeout(120_000);

const REVIEW = 'dc-scan-screen [data-action="review"]';
async function toReview(page: Page, query: string) {
  await page.goto(`/#/simulate?${query}`);
  await expect(page.locator(REVIEW).first()).toBeVisible({ timeout: 90_000 });
  await page.locator(REVIEW).first().click();
  await expect(page.locator('dc-review .summary')).toBeVisible();
}
const noEmailsPath = async (page: Page) => {
  await expect(page.locator('[data-action="to-emails"]')).toHaveCount(0);
  await expect(page.locator('dc-review calcite-checkbox[label^="Include"]')).toHaveCount(0);
  await expect(page.locator('dc-review .owner-foot calcite-label', { hasText: 'in the digest' })).toHaveCount(0);
};

test('a solo org: the note, the admin\'s own list, no ticks, no Emails, and nothing is written', async ({ page }) => {
  const errors: string[] = [];
  const network: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(DEV)) network.push(`${r.method()} ${r.url()}`); });
  await toReview(page, 'n=200&speed=0.02&solo=1');

  const note = page.locator('dc-review [data-note="solo"]');
  await expect(note).toBeVisible();
  await expect(note).toContainText("You're the only owner here, so there's no one to nudge.");
  await expect(note).not.toContainText('!');

  // The to-do list: one list, item links, credits, Mark as done. The chart and the rule panel are still there.
  await expect(page.locator('dc-review .owner')).toHaveCount(1);
  const rows = page.locator('dc-review dc-family-row');
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first().locator('calcite-link')).toHaveAttribute('href', /item\.html\?id=/);
  await expect(rows.first().locator('.c-reclaim')).toContainText('credits a month');
  await expect(rows.first().locator('.mi-done')).toContainText('Mark as done');
  await expect(page.locator('dc-review .chart-block')).toBeVisible();
  await expect(page.locator('dc-review aside.dc-review-side')).toBeVisible();
  await expect(page.locator('dc-review .mi-count')).toContainText('Looking changes nothing and sends nothing');
  await expect(page.locator('dc-review [data-bar="review"]')).toHaveCount(0);
  await noEmailsPath(page);

  // Biggest first: the list is ordered by credits until the admin picks another sort.
  const credits = await page.locator('dc-review dc-family-row .c-reclaim').evaluateAll((els) =>
    els.map((e) => Number(/≈ ([\d,.]+)/.exec(e.textContent ?? '')?.[1]?.replace(/,/g, ''))));
  expect(credits.length).toBeGreaterThan(1);
  for (let i = 1; i < credits.length; i++) expect(credits[i]!).toBeLessThanOrEqual(credits[i - 1]!);

  // Mark as done is kept in this browser and changes the count line.
  await rows.first().locator('.mi-done calcite-checkbox').click();
  await expect(page.locator('dc-review .mi-count')).toContainText('1 item marked as done, in this browser only.');

  // #/emails goes straight back to Review, with the same note.
  await page.evaluate(() => { location.hash = '#/emails'; });
  await expect(page).toHaveURL(/#\/review$/);
  await expect(page.locator('dc-review [data-note="solo"]')).toBeVisible();
  await expect(page.locator('app-emails dc-emails')).toHaveCount(0);

  // Loosen and tighten the rule: an Emails path never shows while the admin is the only owner.
  for (const preset of ['gentle', 'strict', 'balanced', 'suggested']) {
    const item = page.locator(`dc-filters calcite-segmented-control-item[value="${preset}"]`);
    if (await item.count()) await item.first().click();
    await page.waitForTimeout(300);
    await noEmailsPath(page);
    await page.evaluate(() => { location.hash = '#/emails'; });
    await expect(page).toHaveURL(/#\/review$/);
    await noEmailsPath(page);
  }

  // No group, no log table, no notification: the simulator answered only reads, and nothing left the page.
  const sim = await page.evaluate(() => (window as unknown as { __sim: { stats: { calls: Record<string, number> } } }).__sim.stats.calls);
  expect(Object.keys(sim).filter((k) => k === 'other')).toEqual([]);
  expect(network.filter((n) => /sharing\/rest|\/groups|addToGroup|notify|invite|addToDefinition|createService/i.test(n))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a normal simulated org is unchanged: owners to tick, and the Emails step', async ({ page }) => {
  await toReview(page, 'n=200&speed=0.02');
  await expect(page.locator('dc-review [data-note="solo"]')).toHaveCount(0);
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await expect(page.locator('dc-review calcite-checkbox[label^="Include"]').first()).toBeVisible();
  await expect(page.locator('[data-action="to-emails"]')).toBeVisible();
});
