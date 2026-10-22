import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * DC-088 (FB-37): the redirect back from ArcGIS sign-in must never paint the landing (sign-in) screen.
 * The whole OAuth round trip is mocked: no real sign-in, no credentials. Clicking "Sign in" runs the real
 * beginOAuth2 (which stores the PKCE verifier and state); the authorize request is answered with a redirect
 * straight back to the app with a fake code, and the token exchange and org calls return fixed JSON.
 */

const TOKEN_DELAY_MS = 600;
const SELF_DELAY_MS = 400;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Records, from the very first script on a callback load, every landing element added and what each frame shows. */
async function watchCallbackLoad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!/[?&](code|error)=/.test(window.location.search)) return;
    const w = window as unknown as { __landingAdded: number; __frames: string[] };
    w.__landingAdded = 0;
    w.__frames = [];
    const isLanding = (n: Node) => n instanceof Element && (n.matches('[data-page="landing"]') || !!n.querySelector('[data-page="landing"]'));
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (isLanding(n)) w.__landingAdded++;
    }).observe(document, { subtree: true, childList: true });
    const sample = () => {
      const main = document.querySelector('app-root main');
      const page = main?.querySelector('[data-page]')?.getAttribute('data-page') ?? (main?.querySelector('dc-scan-screen') ? 'scan' : main ? 'empty' : 'none');
      if (w.__frames[w.__frames.length - 1] !== page) w.__frames.push(page);
      if (w.__frames.length < 50) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** Mocks ArcGIS: authorize redirects back with a fake code; the token exchange answers per `token`. */
async function mockArcGIS(page: Page, token: 'ok' | 'fail'): Promise<void> {
  await page.route(/\/sharing\/rest\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') return route.continue();
    const path = url.pathname.replace(/^.*\/sharing\/rest\//, '').replace(/\/+$/, '');
    if (path === 'oauth2/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri') ?? 'http://localhost:4173/');
      back.search = `?code=fake-code&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`;
      return route.fulfill({ status: 302, headers: { location: back.toString() } });
    }
    if (path === 'oauth2/token') {
      await delay(TOKEN_DELAY_MS);
      if (token === 'fail') return json(route, { error: { code: 400, error: 'invalid_grant', message: 'Invalid authorization code' } }, 400);
      return json(route, { access_token: 'fake-token', expires_in: 7200, username: 'test.admin', ssl: true });
    }
    if (path === 'portals/self') {
      await delay(SELF_DELAY_MS);
      return json(route, { id: 'testorg', name: 'Test Org', user: { username: 'test.admin', fullName: 'Test Admin', role: 'org_admin', privileges: [] } });
    }
    // Everything else (the usage probe, the scan) fails politely: the app shows its scan screen with an error.
    return json(route, { error: { code: 400, message: 'Mocked in e2e', details: [] } });
  });
}

async function startSignIn(page: Page): Promise<void> {
  await page.goto('/');
  const signIn = page.locator('[data-action="sign-in"]');
  await expect(signIn).toBeVisible();
  test.skip(await signIn.evaluate((e) => e.hasAttribute('disabled')), 'This build has no client ID, so sign-in is switched off.');
  await signIn.click();
}

test('signing in goes straight from the redirect to the app; the sign-in screen never shows', async ({ page }) => {
  await watchCallbackLoad(page);
  await mockArcGIS(page, 'ok');
  await startSignIn(page);

  await expect(page.locator('dc-scan-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/#\/app$/);
  const seen = await page.evaluate(() => {
    const w = window as unknown as { __landingAdded: number; __frames: string[] };
    return { landingAdded: w.__landingAdded, frames: w.__frames };
  });
  console.log('DC-088 callback frames:', seen.frames.join(' -> '));
  expect(seen.landingAdded).toBe(0);
  expect(seen.frames).not.toContain('landing');
  expect(seen.frames).toContain('signing-in');
});

test('a failed token exchange lands on the sign-in error page with the approval message', async ({ page }) => {
  await watchCallbackLoad(page);
  await mockArcGIS(page, 'fail');
  await startSignIn(page);

  await expect(page.locator('[data-page="error"]')).toContainText('approve');
  await expect(page).toHaveURL(/\/#\/error$/);
  expect(await page.evaluate(() => (window as unknown as { __landingAdded: number }).__landingAdded)).toBe(0);
});

test('a plain signed-out visit shows the sign-in screen at once, with no "signing in" state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-page="landing"]')).toBeVisible();
  await expect(page.locator('[data-page="signing-in"]')).toHaveCount(0);
});
