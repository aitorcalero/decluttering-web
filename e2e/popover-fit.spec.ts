import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/*
 * DC-114 (FB-72): every popover and dialog fits a small laptop screen, or scrolls inside itself, with its close control always
 * reachable. Four viewports, the last Surface-like (1536x864 at 1.5x). Set POPFIT_SHOTS=<dir> to save a screenshot of each.
 * Review and Emails run on the built preview in demo mode. The Rescan dialog needs the simulator, which is dev-server only,
 * so that one uses 5173 and skips itself when it isn't running.
 */
const DEV = 'http://localhost:5173';
const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720, scale: 1 },
  { name: '1366x768', width: 1366, height: 768, scale: 1 },
  { name: '1280x600', width: 1280, height: 600, scale: 1 },
  { name: '1536x864@1.5', width: 1536, height: 864, scale: 1.5 },
] as const;

test.setTimeout(120_000);
// DC-116: the demo plays a 30 to 45 second scan; ask for the quick demo (the same flag the other specs use).
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true; }); });
const settle = (page: Page) => page.waitForTimeout(500);

interface Box { x: number; y: number; width: number; height: number }
const shots = process.env.POPFIT_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

/** The box fits the viewport, and the close control sits inside the box and inside the viewport. */
async function expectFits(page: Page, what: string, box: Box | null, close: Box | null): Promise<void> {
  const vp = page.viewportSize()!;
  expect(box, `${what}: is on screen`).not.toBeNull();
  expect(close, `${what}: has a close control`).not.toBeNull();
  const b = box!, c = close!;
  expect.soft(b.x, `${what}: left edge`).toBeGreaterThanOrEqual(-1);
  expect.soft(b.y, `${what}: top edge`).toBeGreaterThanOrEqual(-1);
  expect.soft(b.x + b.width, `${what}: right edge`).toBeLessThanOrEqual(vp.width + 1);
  expect.soft(b.y + b.height, `${what}: bottom edge`).toBeLessThanOrEqual(vp.height + 1);
  expect.soft(c.y, `${what}: close top`).toBeGreaterThanOrEqual(-1);
  expect.soft(c.y + c.height, `${what}: close bottom`).toBeLessThanOrEqual(vp.height + 1);
  expect.soft(c.x + c.width, `${what}: close right`).toBeLessThanOrEqual(vp.width + 1);
  expect.soft(c.x, `${what}: close left`).toBeGreaterThanOrEqual(-1);
}

const rectOf = (page: Page, selector: string): Promise<Box | null> =>
  page.locator(selector).first().boundingBox();

async function popoverFits(page: Page, vpName: string, trigger: string, popover: string): Promise<void> {
  await page.locator(trigger).click();
  await settle(page);
  await expect(page.locator(popover)).toHaveAttribute('open', '');
  const box = await rectOf(page, `${popover} .container`);
  const close = await rectOf(page, `${popover} calcite-action:visible`);
  await expectFits(page, `${popover} at ${vpName}`, box, close);
  // The sticky action bar must not paint over the popover's bottom edge, or the end of the text can't be read.
  const covered = await page.evaluate(({ sel, x, y }) => {
    const pop = document.querySelector(sel)!;
    const top = document.elementFromPoint(x, y);
    return !!top && top !== pop && !pop.contains(top);
  }, { sel: popover, x: box!.x + box!.width / 2, y: box!.y + box!.height - 6 });
  expect.soft(covered, `${popover} at ${vpName}: bottom edge is not covered by something else`).toBe(false);
  if (shots) await page.screenshot({ path: `${shots}/${popover.replace(/\W+/g, '_')}-${vpName.replace('@', '_')}.png` });
  await page.keyboard.press('Escape');
  await settle(page);
}

async function dialogFits(page: Page, vpName: string, id: string): Promise<void> {
  await expect(page.locator(id)).toHaveAttribute('open', '');
  await settle(page);
  const box = await rectOf(page, `${id} .dialog`);
  const close = await rectOf(page, `${id} calcite-action:visible`);
  await expectFits(page, `${id} at ${vpName}`, box, close);
  if (shots) await page.screenshot({ path: `${shots}/${id.replace(/\W+/g, '_')}-${vpName.replace('@', '_')}.png` });
}

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale });

    test('Review info popovers and the Include small items dialog fit', async ({ page }) => {
      await page.goto('/#/demo');
      await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
      await settle(page);
      await popoverFits(page, vp.name, '#preset-info', 'calcite-popover[heading="Starting point"]');
      await popoverFits(page, vp.name, '#usage-info', 'calcite-popover[heading="Last used"]');
      // The small-items dialog is opened directly: it asks only when a lower size adds families.
      await page.evaluate(() => {
        const dlg = document.querySelector('#small-dlg') as (HTMLElement & { open: boolean }) | null;
        if (dlg) dlg.open = true;
      });
      await expect(page.locator('#small-dlg')).toHaveCount(1);
      await dialogFits(page, vp.name, '#small-dlg');
    });

    test('the Emails dialogs fit', async ({ page }) => {
      await page.goto('/#/demo');
      await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
      const cards = page.locator('dc-review [data-card]');
      for (let i = 0; i < await cards.count(); i++) {
        const cb = cards.nth(i).locator('calcite-label calcite-checkbox').first();
        if (!(await cb.evaluate((e) => (e as HTMLInputElement).checked))) await cb.click();
      }
      await page.locator('[data-action="to-emails"]').click();
      await expect(page.locator('dc-emails .em-editor')).toBeVisible();
      await settle(page);
      // First visit shows the intro by itself.
      await dialogFits(page, vp.name, '#em-intro');
      await page.locator('#em-intro [data-action="intro-ok"]').click();
      await expect(page.locator('#em-intro')).not.toHaveAttribute('open', '');
      await settle(page);
      await page.locator('calcite-button[label="Link"]').click();
      await dialogFits(page, vp.name, '#em-link-dlg');
      await page.keyboard.press('Escape');
      await expect(page.locator('#em-link-dlg')).not.toHaveAttribute('open', '');
      await page.locator('dc-emails [data-action="send"]').click();
      await dialogFits(page, vp.name, '#em-confirm');
    });
  });
}

test('the Rescan dialog and the popovers on a larger org fit (simulator, dev server only)', async ({ page }) => {
  test.setTimeout(300_000);
  const up = await fetch(DEV).then((r) => r.ok, () => false);
  test.skip(!up, 'Needs the dev server (npm run dev): the simulator is not in the preview build.');
  await page.addInitScript((ms) => localStorage.setItem('decluttering:fullScanMs', String(ms)), 1_500_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${DEV}/#/simulate?n=1500&speed=0.02`);
  await expect(page.locator('dc-scan-screen section[data-page="app"]')).toHaveAttribute('data-flow', 'done', { timeout: 240_000 });
  await page.locator('dc-scan-screen [data-action="review"]').click();
  await expect(page.locator('[data-scan-state]').first()).toHaveAttribute('data-scan-state', 'done');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await settle(page);
    await page.locator('[data-action="rescan"]').click();
    await dialogFits(page, vp.name, 'calcite-dialog[data-dialog="rescan"]');
    await page.locator('[data-action="rescan-cancel"]').click();
    await expect(page.locator('calcite-dialog[data-dialog="rescan"]')).not.toHaveAttribute('open', '');
    await popoverFits(page, vp.name, '#preset-info', 'calcite-popover[heading="Starting point"]');
    await popoverFits(page, vp.name, '#usage-info', 'calcite-popover[heading="Last used"]');
  }
});
