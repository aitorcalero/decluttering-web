import { expect, test } from '@playwright/test';

test('the language picker switches the steps indicator to Spanish and remembers it', async ({ page }) => {
  await page.goto('/#/demo');
  await expect(page.locator('[data-steps]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-step="review"]')).toContainText('Review');

  await page.locator('calcite-select[data-action="language"]').evaluate((el) => {
    (el as HTMLInputElement).value = 'es';
    el.dispatchEvent(new CustomEvent('calciteSelectChange', { bubbles: true }));
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('[data-step="review"]')).toContainText('Revisión');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('[data-step="review"]')).toContainText('Revisión');
});
