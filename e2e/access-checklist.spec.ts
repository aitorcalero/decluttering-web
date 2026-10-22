// DC-111 (FB-67): the friendly access checklist after sign-in. The whole OAuth round trip is mocked (no real sign-in).
// The mocked usage probe fails, so "Read how layers are used" shows its gentle cross; the org is not writable.
import { test, expect, type Page, type Route } from '@playwright/test';

const ADMIN = ['portal:admin:viewItems', 'portal:admin:viewUsers', 'portal:user:createGroup', 'portal:admin:assignToGroups'];
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function signIn(page: Page, privileges: string[]): Promise<void> {
  await page.route(/\/sharing\/rest\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') return route.continue();
    const path = url.pathname.replace(/^.*\/sharing\/rest\//, '').replace(/\/+$/, '');
    if (path === 'oauth2/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri') ?? 'http://localhost:4173/');
      back.search = `?code=fake-code&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`;
      return route.fulfill({ status: 302, headers: { location: back.toString() } });
    }
    if (path === 'oauth2/token') return json(route, { access_token: 'fake-token', expires_in: 7200, username: 'test.admin', ssl: true });
    if (path === 'portals/self') return json(route, { id: 'testorg', name: 'Test Org', user: { username: 'test.admin', fullName: 'Test Admin', role: 'org_admin', privileges } });
    return json(route, { error: { code: 400, message: 'Mocked in e2e', details: [] } });
  });
  await page.goto('/');
  const btn = page.locator('[data-action="sign-in"]');
  await expect(btn).toBeVisible();
  test.skip(await btn.evaluate((e) => e.hasAttribute('disabled')), 'This build has no client ID, so sign-in is switched off.');
  await btn.click();
  await expect(page).toHaveURL(/#\/app$/, { timeout: 15_000 });
}

const state = (page: Page, id: string) => page.locator(`dc-scan-screen dc-access-checklist [data-cap="${id}"]`).getAttribute('data-state');

test('the card shows the right ticks, can be dismissed, and the user menu reopens it', async ({ page }) => {
  await signIn(page, ADMIN);
  const card = page.locator('dc-scan-screen [data-access="card"]');
  await expect(card).toBeVisible();
  await expect(card.getByRole('list', { name: /what this account can do/i })).toBeVisible();
  expect(await state(page, 'view')).toBe('yes');
  expect(await state(page, 'send')).toBe('yes');
  expect(await state(page, 'usage')).toBe('no');
  expect(['yes', 'neutral']).toContain(await state(page, 'org-send'));
  await expect(card.locator('[data-access="summary"]')).toHaveText(/Review only|all set/);
  await expect(card.locator('[data-access="announce"]')).toHaveAttribute('role', 'status');

  await card.locator('[data-action="access-dismiss"]').click();
  await expect(card).toHaveCount(0);

  await page.locator('calcite-navigation-user').click();
  await page.locator('[data-action="access-open"]').click();
  const dialog = page.locator('calcite-dialog[data-access="dialog"]');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator('[data-cap="view"]')).toHaveAttribute('data-state', 'yes');
  await dialog.locator('[data-action="access-close"]').click();
  await expect(dialog).not.toHaveAttribute('open', '');
});

test('without admin privileges the card says the review is limited to the person\'s own layers', async ({ page }) => {
  await signIn(page, []);
  expect(await state(page, 'view')).toBe('no');
  expect(await state(page, 'send')).toBe('no');
  await expect(page.locator('dc-scan-screen [data-access="summary"]')).toHaveText(/^Your own layers/);
});

test('the demo does not show the card', async ({ page }) => {
  await page.goto('/#/demo');
  await expect(page.locator('dc-access-checklist')).toHaveCount(0);
});
