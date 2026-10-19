import { test, expect } from '@playwright/test';
import { cityIds, cityPath, guidePath, guideTypes, metadata } from '../src/seo';
import { captureAnalytics } from './analytics-browser-helper';

test.describe('English comparison pages without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('all six guides have readable content and matching language links', async ({ page }) => {
    for (const city of cityIds) for (const type of guideTypes) {
      const response = await page.goto(guidePath(city, type, 'en'));
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('h1')).toHaveText(metadata(city, type, 'en').heading);
      await expect(page.getByRole('columnheader', { name: 'Venue / address' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Which offers can be compared?' })).toBeVisible();
      await page.getByRole('link', { name: 'Deutsch', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'de-CH');
      await expect(page.locator('h1')).toHaveText(metadata(city, type).heading);
      await page.getByRole('link', { name: 'English', exact: true }).click();
      await expect(page.locator('h1')).toHaveText(metadata(city, type, 'en').heading);
    }
  });
});

for (const width of [320, 1280]) {
  test(`English city, guide and map navigation stays English at ${width}px`, async ({ page }) => {
    await captureAnalytics(page);
    await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
    await page.setViewportSize({ width, height: 900 });
    for (const city of cityIds) {
      await page.goto(cityPath(city, 'en'));
      await page.locator(`#kaffeepreise a[href="${guidePath(city, 'espresso', 'en')}"]`).first().click();
      await expect(page.locator('h1')).toHaveText(metadata(city, 'espresso', 'en').heading);
      await page.getByLabel('Colour scheme').selectOption('dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.locator(`a[href="${guidePath(city, 'cappuccino', 'en')}"]`).click();
      await expect(page.locator('h1')).toHaveText(metadata(city, 'cappuccino', 'en').heading);
      await expect(page.getByLabel('Colour scheme')).toHaveValue('dark');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (city === 'zurich') await page.screenshot({ path: `/tmp/wobillig-english-guide-${width}.png` });
      await page.locator('.seo-cta').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#coffeeType')).toHaveValue('cappuccino');
      await expect(page.locator('#map-title')).toHaveText(metadata(city, undefined, 'en').heading.replace('Compare coffee', 'Coffee'));
      await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
    }
  });
}
