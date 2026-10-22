import { test, expect, type Page } from '@playwright/test';

/*
 * DC-091: the scan's dot map, mounted on its own (the scan screen needs a signed-in org). The element is registered by the
 * app bundle, so the test puts one on the page with a small revealed model and drives its lens switch and legend.
 */
async function mount(page: Page, expected = 200): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!customElements.get('dc-dot-map'));
  await page.evaluate((expected) => {
    try { localStorage.removeItem('decluttering:dotmap.showSmall'); } catch { /* storage blocked: the default is hidden anyway */ }
    const dots = Array.from({ length: 60 }, (_, i) => {
      const empty = i < 4; // views with no storage of their own
      const small = i >= 4 && i < 10; // measured, fine, under 3 MB
      return {
        id: `id${i}`, title: `Layer ${i}`, owner: 'amy', sizeMB: empty ? 0 : small ? 1 : 5 + i, sized: true, credits: empty ? 0 : 1,
        kind: i % 3 === 0 && !small ? 'stale' : 'fine', candidate: i % 3 === 0 && !small, staleness: (i % 10) / 10, usedBy: i % 4,
        lastUsedDaysAgo: i * 10, daysSinceUpdate: i * 20, nSvc: 1, why: 'x', view: empty || undefined,
      };
    });
    const el = document.createElement('dc-dot-map') as HTMLElement & { model: unknown; expected: number };
    el.expected = expected; // FB-52: the floor applies from 150 layers
    el.model = { dots, revealed: true, exact: true, staleMin: 0.3, maxSizeMB: 100, stats: { found: 60, staleServices: 20, credits: 1, sizeMB: 1 } };
    el.style.display = 'block'; el.style.width = '800px';
    document.body.replaceChildren(el);
  }, expected);
  await expect(page.locator('dc-dot-map calcite-segmented-control-item[value="stale"]')).toBeVisible();
}

const state = (page: Page) => page.evaluate(() => {
  const el = document.querySelector('dc-dot-map') as HTMLElement;
  const items = [...el.querySelectorAll('calcite-segmented-control-item')] as (HTMLElement & { checked: boolean; value: string })[];
  return { selected: items.filter((i) => i.checked).map((i) => i.value), drawn: el.querySelector('.dm-wrap')?.getAttribute('data-lens') };
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`FB-44: the lens switch matches the chart after rapid and mid-fade clicks (motion: ${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await mount(page);
    const item = (v: string) => page.locator(`dc-dot-map calcite-segmented-control-item[value="${v}"]`);
    const seq = ['big', 'stale', 'used', 'big', 'stale', 'used', 'stale', 'big'];
    // No wait (rapid), then waits that land inside the cross-fade (120 ms each half) and around its midpoint.
    for (const gap of [0, 60, 130]) {
      for (const v of seq) { await item(v).click(); if (gap) await page.waitForTimeout(gap); }
      await expect.poll(() => state(page)).toEqual({ selected: ['big'], drawn: 'big' });
      await item('used').click();
      await expect.poll(() => state(page)).toEqual({ selected: ['used'], drawn: 'used' });
    }
  });
}

test('FB-43: How big leaves out the no-storage dots with the small layers, and Show them brings both back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  const line = page.locator('dc-dot-map [data-scan="small-floor"]');
  await expect(line).toContainText('6 layers under 3 MB');
  await expect(line).not.toContainText('minimal storage'); // How stale keeps them: real families there
  await page.locator('dc-dot-map calcite-segmented-control-item[value="big"]').click();
  await expect(line).toContainText('6 layers under 3 MB (about 6.0 credits a month) and 4 with minimal storage (under 0.1 MB) are hidden.');
  const toggle = page.locator('dc-dot-map [data-scan="small-toggle"]');
  await expect(toggle).toHaveText('Show them');
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(line).toContainText('and 4 with minimal storage (under 0.1 MB) are shown.');
  await expect(toggle).toHaveText('Hide them');
});

test('FB-52: an org under 150 layers shows them all, with no small-layer line', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, 0);
  await expect(page.locator('dc-dot-map [data-scan="small-floor"]')).toHaveCount(0);
});
