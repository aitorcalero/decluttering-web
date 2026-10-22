import { test, expect, type Page } from '@playwright/test';

// DC-125b (ADR 0013): sending to owners stays disabled, with a friendly reason, until a test to the admin succeeds.
// The demo itself is never locked, so this mounts a second <dc-emails> beside the demo's on the same page, as a real
// (non-demo) org would see it, with an in-page fake notifier. No network, nothing is sent.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __DC_DEMO_FAST__?: boolean }).__DC_DEMO_FAST__ = true;
    try { localStorage.setItem('dc-email-intro-hidden', '1'); } catch { /* fine */ }
  });
});

async function mountLocked(page: Page, opts: { failFirstTest: boolean }) {
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await page.locator('[data-action="to-emails"]').click();
  await expect(page.locator('app-emails dc-emails[data-page="emails"]')).toBeVisible();
  await page.evaluate((o) => {
    const cur = document.querySelector('dc-emails') as unknown as HTMLElement & Record<string, unknown>;
    const el = document.createElement('dc-emails') as unknown as HTMLElement & Record<string, unknown>;
    let fails = o.failFirstTest;
    const group = { id: 'g', title: 'Decluttering notifications' };
    (window as unknown as { __sent: string[] }).__sent = [];
    el.id = 'locked-em';
    el.owners = cur.owners; el.org = cur.org; el.orgId = 'org-not-real'; el.writable = true; el.demo = false;
    el.admin = { ...(cur.admin as object), email: 'you@example.org' };
    el.ownerSendsUnlocked = false;
    el.notifier = {
      group, whoAmI: async () => 'demo_admin', canCreateGroup: async () => ({ ok: true }), findGroup: async () => group, createGroup: async () => ({ ...group, reused: true }),
      sendTest: async () => { (window as unknown as { __sent: string[] }).__sent.push('test'); if (fails) { fails = false; throw new Error('ArcGIS said no'); } return { to: ['demo_admin'] }; },
    };
    // What the host does: the unlock is the host's word, after a successful test.
    el.addEventListener('dc-emails-test-sent', () => { el.ownerSendsUnlocked = true; });
    cur.style.display = 'none';
    cur.after(el);
  }, opts);
  return page.locator('#locked-em');
}

test('the send button is disabled with a friendly reason until a test succeeds, then enables', async ({ page }) => {
  const em = await mountLocked(page, { failFirstTest: false });
  const send = em.locator('[data-action="send"]');
  await expect(send).toHaveAttribute('disabled', '');
  await expect(em.locator('[data-note="test-first"]')).toHaveText('Send yourself a test first. It takes a moment, and you’ll see exactly what owners get.');
  await expect(em.locator('[data-note="test-each-session"]')).toContainText('We ask for a quick test each time you sit down to send');
  await expect(em.locator('[data-action="test"]')).toHaveAttribute('data-next', 'true');

  await em.locator('[data-action="test"]').click();
  await expect(page.locator('[data-toast]').last()).toContainText('Sending to owners is now unlocked for this session.');
  await expect(send).not.toHaveAttribute('disabled', '');
  await expect(em.locator('[data-note="test-first"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent)).toEqual(['test']);
});

test('a test that fails never unlocks', async ({ page }) => {
  const em = await mountLocked(page, { failFirstTest: true });
  await em.locator('[data-action="test"]').click();
  await expect(page.locator('[data-toast]').last()).toContainText('ArcGIS said no');
  await expect(em.locator('[data-action="send"]')).toHaveAttribute('disabled', '');
  await expect(em.locator('[data-note="test-first"]')).toBeVisible();
});

test('the demo itself keeps its full flow (no lock, no reason line)', async ({ page }) => {
  await page.goto('/#/demo');
  await expect(page.locator('dc-review [data-card]').first()).toBeVisible();
  await page.locator('[data-action="to-emails"]').click();
  await expect(page.locator('dc-emails [data-action="send"]')).not.toHaveAttribute('disabled', '');
  await expect(page.locator('dc-emails [data-note="test-first"]')).toHaveCount(0);
});
