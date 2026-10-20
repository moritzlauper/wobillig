import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';

test('pizza selection remains available when prices are recorded for other varieties', async ({ page }) => {
  const data = JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset;
  const source = data.bars.flatMap(bar => bar.offers)[0];
  data.bars = data.bars.slice(0, 20).map(bar => ({ ...bar, type: 'restaurant', offers: [],
    pizzaMenu: [{ ...source, name: 'Prosciutto', pizzaType: 'other', priceChf: 21 }] }));
  await page.route('**/data/pizza.json', route => route.fulfill({ json: data }));
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.goto('/?drink=pizza&pizzaSelection=all');
  await expect(page.locator('#pizza-selection')).toBeVisible();
  await page.locator('#pizza-selection').selectOption({ label: 'Prosciutto' });
  await expect(page.locator('#results .venue')).toHaveCount(20);
});

for (const width of [320, 1280]) {
  test(`pizza search compares the selected menu item at ${width}px`, async ({ page }) => {
    const data = JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset;
    for (const bar of data.bars) bar.pizzaMenu = [];
    const venue = data.bars.find(b => b.type === 'restaurant' && b.offers.length)!;
    venue.offers = [{ ...venue.offers[0], name: 'Margherita', priceChf: 16 }];
    venue.pizzaMenu = [{ ...venue.offers[0], name: 'Prosciutto', pizzaType: 'other', priceChf: 21,
      ingredients: 'Tomaten, Mozzarella, Schinken' }];
    await page.route('**/data/pizza.json', route => route.fulfill({ json: data }));
    await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
    await page.route('**/api/google-rating?*', route => route.fulfill({ json: { rating: null } }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?drink=pizza');
    await expect(page.locator('#pizza-selection')).toHaveValue('margherita');
    await expect(page.locator('#pizza-selection option')).toHaveCount(3);
    await page.locator('#pizza-selection').selectOption({ label: 'Prosciutto' });
    await expect(page.locator('#results .venue')).toHaveCount(1);
    await expect(page.locator('#results .venue')).toContainText('21.00');
    await expect(page.locator('#pizza-query')).toHaveValue('');
    await page.reload();
    await expect(page.locator('#pizza-selection')).toHaveValue('name:prosciutto');
    await expect(page.locator('#results .venue')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Pizzaname oder Zutat' }).fill('proscuito');
    await expect(page.locator('#pizza-selection')).toHaveValue('all');
    const result = page.locator('#results .venue');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('Prosciutto');
    await expect(result).toContainText('21.00');
    await expect(page.locator('#city-average')).toContainText('21.00');
    if (width < 760) await page.locator('#view-list').click();
    await result.click();
    const selectedPizza = page.locator('#detail .offer').filter({ hasText: 'Prosciutto' });
    await expect(selectedPizza).toHaveCount(1);
    await expect(selectedPizza).toContainText('Schinken');
    await expect(selectedPizza.locator('[data-edit]')).toHaveCount(0);
    await expect(page.locator('#detail')).not.toContainText('Pro Pizza');
    await page.reload();
    await expect(page.locator('#pizza-query')).toHaveValue('proscuito');
    await expect(result).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('#pizza-selection').selectOption('margherita');
    await expect(page.locator('#pizza-query')).toHaveValue('');
    await expect(page.locator('#results')).not.toContainText('Prosciutto');
  });
}
