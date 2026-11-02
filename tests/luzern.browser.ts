import { test, expect } from '@playwright/test';
import { captureAnalytics } from './analytics-browser-helper';

test.beforeEach(async ({ page }) => {
  await captureAnalytics(page);
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [], venues: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.route('**/api/tip?*', route => route.fulfill({ status: 503, json: {} }));
});

// Use the shipped datasets: mocked offers would hide an unpopulated city.
for (const drink of ['coffee', 'beer']) {
  test(`Luzern ships visible ${drink} prices with source links`, async ({ page }) => {
    await page.goto(`/luzern?drink=${drink}`);
    await expect(page.locator('#map-title')).toContainText('Luzern');
    await expect(page.locator('#count')).not.toContainText('Laden');
    await expect(page.locator(`#drink-${drink}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.price-marker:not(.unknown)').first()).toHaveText(/\d+\.\d{2}/);
    await page.locator('#view-list').click();
    const first = page.locator('#results .venue').first();
    await expect(first.locator('.venue-price')).toHaveText(/\d+\.\d{2}/);
    await first.click();
    const offer = page.locator('#detail .offer:not(.other-offer)').first();
    await expect(offer).toContainText(/CHF \d+\.\d{2}/);
    await expect(offer.getByRole('link', { name: 'Quelle', exact: true })).toHaveAttribute('href', /^https?:\/\//);
  });
}

test('Luzern publishes its recorded pizza prices in the Margherita ranking', async ({ page }) => {
  // The map's Pizza category needs 14 priced venues; the ranking already shows smaller datasets.
  await page.goto('/margherita-luzern');
  await expect(page.locator('h1')).toContainText('Pizza Margherita in Luzern');
  const first = page.locator('tbody tr').first();
  await expect(first.locator('td').first()).toHaveText(/\d+\.\d{2}/);
  await expect(first.getByRole('link', { name: 'Preisquelle', exact: true })).toHaveAttribute('href', /^https?:\/\//);
});
