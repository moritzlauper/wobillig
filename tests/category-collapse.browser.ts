import { test, expect } from '@playwright/test';

// Uses the published datasets, so ramen, burger and soft drinks are available as they are in production.
test('ramen, burger and soft drinks sit behind Weitere, only coffee, beer and pizza stay visible', async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier', 'Pizza']);
  await page.locator('#categories-toggle').click();
  await expect(page.locator('#additional-categories')).toContainText('Ramen');
  await expect(page.locator('#additional-categories')).toContainText('Burger');
  await expect(page.locator('#additional-categories')).toContainText('Softdrinks');
});
