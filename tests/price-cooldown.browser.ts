import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';
import { captureAnalytics } from './analytics-browser-helper';

const data = JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset;
const bar = data.bars.find(venue => venue.offers.length)!;

for (const language of ['de', 'en']) {
  test(`cooldown keeps the price form and shows the remaining wait in ${language}`, async ({ page }) => {
    await captureAnalytics(page);
    await page.route('**/api/prices?*', route => route.fulfill(route.request().method() === 'GET'
      ? { json: { entries: [] } }
      : { status: 429, headers: { 'Retry-After': '125' }, json: {
        error: 'Zu viele Preisänderungen. Bitte kurz warten und erneut versuchen.', retryAfter: 125,
      } }));
    await page.goto(`${language === 'en' ? '/en' : '/'}?drink=coffee&bar=${encodeURIComponent(bar.id)}`);
    await page.locator('#add-here').click();
    await page.locator('#manual-entry > summary').click();
    await page.locator('#entry-price').fill('5.00');
    await page.locator('#save-price').click();
    await expect(page.locator('#form-error')).toHaveText(language === 'en'
      ? 'Maximum 10 price submissions per 10 minutes. Please wait another 3 min.'
      : 'Maximal 10 Preiseingaben pro 10 Minuten. Bitte warte noch 3 Min.');
    await expect(page.locator('#price-dialog')).toBeVisible();
    await expect(page.locator('#entry-price')).toHaveValue('5.00');
    await expect(page.locator('#save-price')).toBeEnabled();
  });
}
