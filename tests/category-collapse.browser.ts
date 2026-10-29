import { test, expect } from '@playwright/test';

// Uses the published datasets, so ramen, burger, soft drinks and cocktails are available as they are in production.
test('coffee and pizza lead, the two most clicked categories follow and the rest sit behind Weitere', async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: { beer: 50, cocktail: 40, softdrink: 30 } } }));
  // An even two-day period, so the fourth place does not rotate.
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Pizza', 'Bier', 'Cocktails']);
  await page.locator('#categories-toggle').click();
  await expect(page.locator('#additional-categories')).toContainText('Softdrinks');
  await expect(page.locator('#additional-categories')).toContainText('Ramen');
  await expect(page.locator('#additional-categories')).toContainText('Burger');
});
