import { test, expect } from '@playwright/test';
import { showSearch } from './search-row-helper';

for (const width of [320, 1280]) {
  test(`automatic budget follows listed prices and preserves manual limits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.route('**/api/**', route => route.fulfill({ json: { entries: [], counts: {}, enabled: false } }));
    const base = { volumeMl: null, alcoholFree: true, confidence: 'reviewed', observedAt: '2026-10-21', sourceUrl: '', evidence: '' };
    await page.route('**/data/*.json', route => {
      const file = new URL(route.request().url()).pathname.split('/').pop();
      const bars = ['Budget', 'Premium', 'Unknown'].map((name, index) => ({
        id: `budget-${index}`, name, type: 'restaurant', lat: 47.378, lon: 8.535 + index * .001,
        address: 'Testgasse 1', postcode: '8001', website: null, openingHours: null, outdoor: false, checkedAt: null,
        offers: index === 2 ? [] : file === 'coffee.json' ? [
          { ...base, name: 'Cappuccino', coffeeType: 'cappuccino', priceChf: index ? 18.75 : 4.25 },
          { ...base, name: 'Cappuccino gross', coffeeType: 'cappuccino', priceChf: 26 },
          { ...base, name: 'Espresso', coffeeType: 'espresso', priceChf: index ? 7.35 : 3.15 },
        ] : file === 'bars.json' ? [{ ...base, name: 'Lager', priceChf: index ? 16.4 : 4, volumeMl: 330, alcoholFree: false, beerType: 'draft' }]
          : file === 'pizza.json' ? [{ ...base, name: 'Margherita', pizzaType: 'margherita', priceChf: index ? 38.9 : 18 }] : [],
      }));
      // Pizza navigation requires at least twenty priced venues in the city.
      if (file === 'pizza.json') for (let i = 0; i < 18; i++) bars.push({ ...bars[0], id: `pizza-${i}`, name: `Pizza ${i}` });
      return route.fulfill({ json: { bars, generatedAt: '', discoveredAt: '', attribution: '' } });
    });
    await page.goto('/');
    await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#results .venue')).toHaveCount(1);
    await page.locator('#cheap').click();
    const price = page.locator('#price');
    await expect(price).toHaveValue('18.75');
    await expect(page.locator('#results .venue-price')).toContainText(['4.25', '18.75', 'Noch nicht erfasst']);
    expect(new URL(page.url()).searchParams.has('max')).toBe(false);
    await page.locator('#coffeeType').selectOption('espresso');
    await expect(price).toHaveValue('7.35');
    await showSearch(page);
    await page.locator('#search').fill('Budget');
    await expect(price).toHaveValue('3.15');
    await page.locator('#search').fill('Unknown');
    await expect(price).toHaveValue('');
    await page.locator('#search').fill('');
    await price.fill('5');
    await page.locator('#coffeeType').selectOption('cappuccino');
    await expect(price).toHaveValue('5');
    await expect(page.locator('#results [data-bar="budget-1"]')).toHaveCount(0);
    await page.reload();
    await expect(price).toHaveValue('5');
    await page.locator('#filters-toggle').click();
    await page.locator('#reset').click();
    await expect(price).toHaveValue('18.75');
    await page.getByRole('button', { name: 'Bier', exact: true }).click();
    await expect(price).toHaveValue('16.4');
    await page.getByRole('button', { name: 'Pizza', exact: true }).click();
    await expect(price).toHaveValue('38.9');
    await price.fill('30');
    await page.getByRole('button', { name: 'Kaffee', exact: true }).click();
    await expect(price).toHaveValue('18.75');
    await page.getByRole('button', { name: 'Pizza', exact: true }).click();
    await expect(price).toHaveValue('30');
    await price.fill('');
    await price.blur();
    await expect(price).toHaveValue('38.9');
    expect(new URL(page.url()).searchParams.has('max')).toBe(false);
  });
}
