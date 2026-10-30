import { test, expect } from '@playwright/test';

for (const width of [320, 1280]) {
  test(`the price range narrows the list and keeps manual limits at ${width}px`, async ({ page }) => {
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
    const cheap = page.locator('#cheap'), price = page.locator('#price');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#results .venue')).toHaveCount(1);
    // Without the cheap filter the range opens fully and lists every venue.
    await cheap.click();
    await expect(cheap).toHaveText('Alle Preise');
    await expect(page.locator('#results .venue-price')).toContainText(['4.25', '18.75', 'Noch nicht erfasst']);
    expect(new URL(page.url()).searchParams.has('max')).toBe(false);
    // Moving the slider sets a limit that survives reloads; another category opens at its cheap price.
    await price.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(cheap).toHaveText('Bis CHF 5');
    await expect(page.locator('#results [data-bar="budget-1"]')).toHaveCount(0);
    await page.reload();
    await expect(cheap).toHaveText('Bis CHF 5');
    // Another coffee type opens at its own cheap price.
    await page.locator('#coffeeType').selectOption('espresso');
    await expect(cheap).toHaveText('Günstig bis CHF 3.15');
    await page.locator('#coffeeType').selectOption('cappuccino');
    await price.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Bier', exact: true }).click();
    await expect(cheap).toContainText('Günstig bis CHF');
    await page.getByRole('button', { name: 'Kaffee', exact: true }).click();
    await expect(cheap).toContainText('Günstig bis CHF');
    // The right end removes the limit again; the button returns to the cheap price.
    // Dragging to the right end of the track removes the limit.
    const track = (await price.boundingBox())!;
    await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width + 20, track.y + track.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(cheap).toHaveText('Alle Preise');
    expect(new URL(page.url()).searchParams.has('max')).toBe(false);
    await cheap.click();
    await expect(cheap).toContainText('Günstig bis CHF');
  });
}
