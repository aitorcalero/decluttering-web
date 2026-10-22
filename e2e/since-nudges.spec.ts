// DC-096: "Since your nudges" on Review (demo mode, no network). The demo reads its seeded nudge log through the real log
// code over an in-memory fake; expected wording is worked out from the same files with the same domain functions.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ownerChip, sinceLine, sinceNudges } from '../src/domain/outcomes';
import { sendsOf } from '../src/log/rows';
import type { Data } from '../src/domain/types';

// DC-116: the demo plays a 30 to 45 second scan; this spec only needs the Review page and public/demo/mock-small.json, so it asks for the quick demo.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });

const data = JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo/mock-small.json'), 'utf8')) as Data;
const log = JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo/mock-small-log.json'), 'utf8')) as { rows: Record<string, unknown>[] };
const since = sinceNudges(data, sendsOf(log.rows.map((attributes) => ({ attributes }))));

test('the demo shows the card with what changed, opens to a per-owner list, and extends the Nudged chip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  expect(since, 'fixture: the demo log has sends').not.toBeNull();
  expect(since!.counts.gone, 'fixture: some items are gone').toBeGreaterThan(0);
  await page.goto('/#/demo');
  const card = page.locator('dc-review dc-since-nudges calcite-block[data-since="card"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('heading', 'Since your nudges');
  await expect(card).toHaveAttribute('description', sinceLine(since!));
  expect(sinceLine(since!)).not.toMatch(/because|deleted/i);
  // Above the summary.
  const order = await page.evaluate(() => {
    const main = document.querySelector('dc-review .dc-review-main');
    return [...(main?.children ?? [])].map((n) => n.tagName.toLowerCase() + (n.classList.contains('summary') ? '.summary' : ''));
  });
  expect(order.indexOf('dc-since-nudges')).toBeLessThan(order.indexOf('section.summary'));

  await card.click({ position: { x: 40, y: 20 } });
  await expect(card.locator('.sn-owner')).toHaveCount(since!.owners.length);
  await expect(card.locator('li[data-outcome="gone"]')).toHaveCount(since!.counts.gone);
  if (since!.counts.used) await expect(card.locator('li[data-outcome="used"] .sn-tip').first()).toHaveText('Someone used it after the nudge; it may still be needed.');
  await expect(card.locator('li[data-outcome="updated"] calcite-link').first()).toHaveAttribute('href', /maps\.arcgis\.com\/home\/item\.html\?id=/);

  // An owner nudged in the last six months gets "· n of m gone" on their chip.
  const recent = since!.owners.find((o) => ownerChip(o) && data.owners.find((x) => x.username === o.owner)?.lastNotified);
  expect(recent, 'fixture: a recently nudged owner with something gone').toBeTruthy();
  await expect(page.locator(`dc-review [data-card="${recent!.owner}"] .c-nudged`)).toContainText(`· ${ownerChip(recent!)}`);
  expect(errors).toEqual([]);
});

test('no log: no card, and nothing claimed', async ({ page }) => {
  await page.route('**/demo/mock-small-log.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await expect(page.locator('dc-review .summary')).toBeVisible();
  await expect(page.locator('dc-since-nudges calcite-block')).toHaveCount(0);
  await expect(page.locator('dc-review .c-nudged', { hasText: 'gone' })).toHaveCount(0);
});
