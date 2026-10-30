import { test, expect } from '@playwright/test';
import { showSearch } from './search-row-helper';
import { readFileSync } from 'node:fs';
import { isGlutenFreePizza, type Dataset } from '../src/data';

test('cheap prices follow pizza selection and search while the shortcut is active', async ({ page }) => {
  const data = JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset;
  const source = data.bars.flatMap(bar => bar.offers)[0];
  data.bars = data.bars.slice(0, 20).map((bar, index) => ({
    ...bar, type: 'restaurant', offers: [{ ...source, name: 'Margherita', priceChf: 16 }],
    pizzaMenu: [
      { ...source, name: 'Formaggi della casa', pizzaType: 'other', priceChf: index < 4 ? 20 : 24,
        ingredients: 'Mozzarella, Gorgonzola, Taleggio, Parmesan' },
      { ...source, name: 'Prosciutto', pizzaType: 'other', priceChf: index < 4 ? 22 : 26,
        ingredients: 'Tomaten, Mozzarella, Schinken' },
    ],
  }));
  await page.route('**/data/pizza.json', route => route.fulfill({ json: data }));
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.goto('/?drink=pizza&cheap=0');
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'false');
  // Another pizza opens at its own cheap price.
  await page.locator('#pizza-selection').selectOption('group:quattro_formaggi');
  await expect(page.locator('#cheap')).toHaveText('Bis CHF 20.00');
  await expect(page.locator('#price')).toHaveAttribute('aria-valuenow', '20');
  await expect(page.locator('#results .venue')).toHaveCount(4);
  await page.locator('#pizza-selection').selectOption('group:prosciutto');
  await expect(page.locator('#cheap')).toHaveText('Bis CHF 22.00');
  await expect(page.locator('#price')).toHaveAttribute('aria-valuenow', '22');
  await expect(page.locator('#results .venue')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#price')).toHaveAttribute('aria-valuenow', '22');
  await showSearch(page);
  await page.locator('#pizza-query').fill('gorgonzola');
  await expect(page.locator('#cheap')).toHaveText('Bis CHF 20.00');
  await expect(page.locator('#price')).toHaveAttribute('aria-valuenow', '20');
  await expect(page.locator('#results .venue')).toHaveCount(4);
  await page.locator('#pizza-query').fill('unbekannte zutat');
  await expect(page.locator('#cheap')).toHaveText('Günstig');
  await expect(page.locator('#results .venue')).toHaveCount(0);
  await page.locator('#pizza-selection').selectOption('margherita');
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#results .venue')).toHaveCount(20);
  await page.locator('#cheap').click();
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'false');
});

test('pizza groups compare house names by ingredients without a Margherita price', async ({ page }) => {
  const data = JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset;
  const source = data.bars.flatMap(bar => bar.offers)[0];
  data.bars = data.bars.slice(0, 20).map(bar => ({ ...bar, type: 'restaurant', offers: [],
    pizzaMenu: [{ ...source, name: 'Speciale della casa', pizzaType: 'other', priceChf: 21,
      ingredients: 'Pomodoro, mozzarella, prosciutto cotto' }] }));
  await page.route('**/data/pizza.json', route => route.fulfill({ json: data }));
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.goto('/?drink=pizza&pizzaSelection=all');
  await expect(page.locator('#pizza-selection')).toBeVisible();
  await expect(page.locator('#pizza-selection option')).toHaveCount(3);
  await page.locator('#pizza-selection').selectOption({ label: 'Prosciutto' });
  await expect(page.locator('#results .venue')).toHaveCount(20);
  await expect(page.locator('#results .venue').first()).toContainText('Speciale della casa');
  await expect(page.locator('#results .venue').first()).toContainText('21.00');
});

for (const width of [320, 1280]) {
  test(`pizza search compares the selected menu item at ${width}px`, async ({ page }) => {
    const data = JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset;
    for (const bar of data.bars) bar.pizzaMenu = [];
    // Gluten-free pizzas elsewhere would add a filter option, so drop them. The venues stay for the pizza threshold.
    for (const bar of data.bars) bar.offers = bar.offers.filter(offer => !(offer.pizzaType && isGlutenFreePizza(offer, bar)));
    const venue = data.bars.find(b => b.type === 'restaurant' && b.offers.length)!;
    // The real first offer may carry toppings that put it into another pizza group, so state the toppings explicitly.
    venue.offers = [{ ...venue.offers[0], name: 'Margherita', pizzaType: 'margherita', priceChf: 16, ingredients: 'Tomaten, Mozzarella' }];
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
    await expect(page.locator('#pizza-selection')).toHaveValue('group:prosciutto');
    await expect(page.locator('#results .venue')).toHaveCount(1);
    await showSearch(page);
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
