import { test, expect } from '@playwright/test';

// DC-110: the About page diagram, the GitHub line and the contact link (demo mode, no network needed).
test('About shows the diagrams, the GitHub link and the contact link', async ({ page }) => {
  await page.goto('/#/about');
  const flows = page.locator('dc-about [role="img"].about-flow');
  await expect(flows).toHaveCount(2);
  await expect(flows.first()).toHaveAttribute('aria-label', /hidden group|Your data/);
  await expect(page.locator('dc-about a.about-back')).toHaveText(/Back to/);
  await expect(page.locator('dc-about .about-repo')).toContainText('Source code on GitHub');
  await page.locator('dc-about details[data-section="open"] summary').click();
  await expect(page.locator('dc-about .about-repo')).not.toContainText('first release');
  const link = page.locator('dc-about calcite-button.about-contact');
  await expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/simongis/');
  await expect(link).toContainText('Contact me');
  await expect(page.locator('dc-about .about-repo a')).toHaveAttribute('href', 'https://github.com/simongis/decluttering-web');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
});

// DC-125f: the admin guide for orgs that only allow approved apps.
test('About has the administrator guide for approved apps', async ({ page }) => {
  await page.goto('/#/about');
  await expect(page.getByRole('heading', { name: 'For administrators: approving Decluttering' })).toBeVisible();
  await expect(page.locator('dc-about a.about-esri')).toHaveAttribute('href', /configure-security\.htm/);
});

// Screenshots for review: only when SHOTS_DIR is set.
for (const [w, h] of [[1280, 900], [400, 900]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`About screenshot ${w} ${scheme}`, async ({ page }) => {
      test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR to capture');
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/#/about');
      await page.evaluate((m) => { for (const el of [document.documentElement, document.body]) el.className = 'calcite-mode-' + m; }, scheme);
      await page.locator('dc-about .about-flow').first().waitFor();
      await page.locator('dc-about calcite-icon').evaluateAll((els) => Promise.all(els.map((e) => (e as unknown as { componentOnReady(): Promise<unknown> }).componentOnReady())));
      await page.locator('dc-about calcite-icon').evaluateAll((els) => Promise.all(els.map((e) => (e as unknown as { componentOnReady(): Promise<unknown> }).componentOnReady())));
      await page.locator('dc-about details').evaluateAll((els) => els.forEach((e) => ((e as HTMLDetailsElement).open = true)));
      for (const id of ['data', 'email', 'open']) { await page.locator('dc-about section[aria-labelledby="about-h-' + id + '"] calcite-icon').evaluateAll((els) => els.forEach((e) => e.scrollIntoView())); await page.waitForTimeout(500); }
      for (const id of ['data', 'email', 'open']) await page.locator('dc-about section[aria-labelledby="about-h-' + id + '"]').screenshot({ path: process.env.SHOTS_DIR + '/about-' + id + '-' + w + '-' + scheme + '.png' });
    });
  }
}
