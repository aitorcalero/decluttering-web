// ADR 0013 / DC-125e: "Turn off sending" on the access checklist. The whole sign-in and every ArcGIS request are mocked (no
// network, nothing real is removed). Needs a build that lets this org opt in (VITE_SENDING=list with the org id, or opt-in);
// otherwise the row has no button and the spec skips. Only the admin's own group is ever deleted, and the log never is.
import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';

const PRIV = ['portal:admin:viewItems', 'portal:admin:viewUsers', 'portal:user:createGroup', 'portal:admin:assignToGroups'];
const GID = 'c'.repeat(32);
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function orgId(): string {
  try {
    const env = fs.readFileSync('.env', 'utf8');
    const first = /^VITE_WRITABLE_ORG_IDS=(.*)$/m.exec(env)?.[1]?.split(',')[0]?.trim();
    if (first) return first;
  } catch { /* no .env */ }
  return 'testorg';
}

/** Whether this build lets the mocked org opt in: decided from the build's own settings, never from a half-loaded page. */
function buildCanOptIn(): boolean {
  try {
    const env = fs.readFileSync('.env', 'utf8');
    const mode = /^VITE_SENDING=(.*)$/m.exec(env)?.[1]?.trim();
    return mode === 'opt-in' || (mode === 'list' && orgId() !== 'testorg');
  } catch { return false; }
}

async function signIn(page: Page, o: { refuse?: boolean } = {}) {
  const writes: string[] = [];
  let exists = true;
  await page.route(/\/sharing\/rest\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') return route.continue();
    const path = url.pathname.replace(/^.*\/sharing\/rest\//, '').replace(/\/+$/, '');
    if (route.request().method() === 'POST' && /^(community|content)\//.test(path)) writes.push(path); // sign-in and usage reads are POSTs too
    if (path === 'oauth2/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri') ?? 'http://localhost:4173/');
      back.search = `?code=fake-code&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`;
      return route.fulfill({ status: 302, headers: { location: back.toString() } });
    }
    if (path === 'oauth2/token') return json(route, { access_token: 'fake-token', expires_in: 7200, username: 'test.admin', ssl: true });
    if (path === 'portals/self') return json(route, { id: orgId(), name: 'Test Org', user: { username: 'test.admin', fullName: 'Test Admin', role: 'org_admin', privileges: PRIV } });
    if (path === 'community/groups') return json(route, { results: exists ? [{ id: GID, title: 'Decluttering notifications', owner: 'test.admin', access: 'private' }] : [] });
    if (path === `community/groups/${GID}/delete`) {
      if (o.refuse) return json(route, { error: { code: 400, message: 'You do not have permissions', details: [] } });
      exists = false;
      return json(route, { success: true });
    }
    return json(route, { error: { code: 400, message: 'Mocked in e2e', details: [] } });
  });
  await page.goto('/');
  const btn = page.locator('[data-action="sign-in"]');
  await expect(btn).toBeVisible();
  test.skip(await btn.evaluate((e) => e.hasAttribute('disabled')), 'This build has no client ID, so sign-in is switched off.');
  await btn.click();
  await expect(page).toHaveURL(/#\/app$/, { timeout: 15_000 });
  const row = page.locator('dc-scan-screen dc-access-checklist [data-cap="org-send"]');
  await expect(row).toBeVisible();
  test.skip(!buildCanOptIn(), 'This build does not let this org opt in, so there is nothing to turn off.');
  // Wait for the settled "on for you" state (the group check runs after sign-in); fail, don't skip, if it never comes.
  await expect.poll(async () => (await row.getAttribute('data-state')) ?? '', { timeout: 15_000 }).toBe('yes');
  await expect(row.locator('[data-action="turn-off-sending"]')).toHaveCount(1);
  return { row, writes };
}

const active = (page: Page) => page.evaluate(() => {
  let el: Element | null = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) { if (el.matches('[data-focus], [data-action]')) break; el = el.shadowRoot.activeElement; }
  const host = (el as Element | null)?.closest?.('[data-focus]') ?? el;
  return host ? `${host.tagName.toLowerCase()}${host.getAttribute('data-action') ? '[' + host.getAttribute('data-action') + ']' : ''}` : '';
});

test('turning sending off: confirm opens on "Keep it on", removes only the group, and the row goes back to off', async ({ page }) => {
  const { row, writes } = await signIn(page);
  await row.locator('[data-action="turn-off-sending"]').click();
  const dialog = page.locator('#turn-off-dialog');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog).toHaveAttribute('heading', 'Turn off sending?');
  await expect(dialog).toContainText('Your nudge log stays');
  await expect(dialog.locator('[data-action="turn-off-keep"]')).toHaveText('Keep it on');
  await expect(dialog.locator('[data-action="turn-off-yes"]')).toHaveText('Turn off sending');
  await expect.poll(() => active(page)).toContain('[turn-off-keep]');

  await dialog.locator('[data-action="turn-off-keep"]').click();
  await expect(dialog).not.toHaveAttribute('open', '');
  expect(writes).toEqual([]);

  await row.locator('[data-action="turn-off-sending"]').click();
  await dialog.locator('[data-action="turn-off-yes"]').click();
  await expect(page.locator('[data-toast="turn-off"]')).toHaveText('Sending is off. Your nudge log is still there.');
  expect(writes).toEqual([`community/groups/${GID}/delete`]);
  await expect(row).toHaveAttribute('data-state', 'neutral');
  await expect(row.locator('[data-action="turn-on-sending"]')).toBeVisible();
});

test('if ArcGIS refuses, the friendly message shows and sending stays on', async ({ page }) => {
  const { row } = await signIn(page, { refuse: true });
  await row.locator('[data-action="turn-off-sending"]').click();
  const dialog = page.locator('#turn-off-dialog');
  await dialog.locator('[data-action="turn-off-yes"]').click();
  await expect(dialog.locator('[data-turn-off="error"]')).toContainText('ArcGIS Online wouldn’t remove it');
  await expect(row).toHaveAttribute('data-state', 'yes');
  await expect(row.locator('[data-action="turn-off-sending"]')).toBeVisible();
});
