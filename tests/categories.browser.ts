import { test, expect } from '@playwright/test';
import { emptyCategoryCounts } from '../src/categories';

test.beforeEach(async ({ context }) => {
  await context.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  // Burger, ramen and gastro datasets are published by their scans; the category counts here must not depend on them.
  for (const dataset of ['burger', 'ramen', 'gastro-softdrink', 'gastro-cocktail', 'locations']) {
    await context.route(`**/data/${dataset}.json`, route => route.fulfill({ json: { bars: [] } }));
  }
  for (const foodType of ['doner', 'falafel']) {
    await context.route(`**/data/**${foodType}.json`, route => route.fulfill({ json: {
      bars: [{ type: 'fast_food', offers: Array.from({ length: 50 }, () => ({ foodType, portionType: 'wrap', priceChf: 12 })) }],
    } }));
  }
});

for (const [doner, falafel, visible] of [
  [49, 49, []], [50, 49, ['Döner']], [49, 50, ['Falafel']], [50, 50, ['Döner', 'Falafel']],
] as const) {
  test(`price threshold is independent for each category: ${doner} doner, ${falafel} falafel`, async ({ page }) => {
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: { doner: 9999, falafel: 9999 } } }));
    for (const [foodType, count] of [['doner', doner], ['falafel', falafel]] as const) {
      await page.route(`**/data/${foodType}.json`, route => route.fulfill({ json: {
        bars: [{ type: 'fast_food', offers: Array.from({ length: count }, () => ({ foodType, portionType: 'wrap', priceChf: 12 })) }],
      } }));
    }
    const loaded = Promise.all(['doner', 'falafel'].map(category => page.waitForResponse(`**/data/${category}.json`)));
    await page.goto('/');
    await loaded;
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    await expect(page.locator('#primary-categories #drink-doner, #primary-categories #drink-falafel')).toHaveCount(0);
    if (visible.length) {
      await page.locator('#categories-toggle').click();
      await expect(page.locator('#additional-categories button:visible')).toHaveText(visible);
    } else {
      await expect(page.locator('#categories-toggle')).toBeHidden();
      await expect(page.locator('#drink-doner')).toBeHidden();
      await expect(page.locator('#drink-falafel')).toBeHidden();
    }
  });
}

test('missing or unreadable city datasets keep unavailable categories hidden', async ({ page }) => {
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: { doner: 9999, falafel: 9999 } } }));
  await page.route('**/data/bern/doner.json', route => route.fulfill({ status: 404 }));
  await page.route('**/data/bern/falafel.json', route => route.fulfill({ contentType: 'text/html', body: '<html>Not found</html>' }));
  const loaded = Promise.all(['doner', 'falafel'].map(category => page.waitForResponse(`**/data/bern/${category}.json`)));
  await page.goto('/bern');
  await loaded;
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await expect(page.locator('#categories-toggle')).toBeHidden();
  await expect(page.locator('#drink-doner')).toBeHidden();
  await expect(page.locator('#drink-falafel')).toBeHidden();
  await expect(page.locator('#create-map')).toBeVisible();
});

for (const width of [320, 390, 1280]) {
  test(`Doner and Falafel stay in More regardless of popularity at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    let counts = { coffee: 100, beer: 80, pizza: 5, doner: 4, falafel: 0 };
    const clicks: string[] = [];
    await context.route('**/api/categories', async route => {
      if (route.request().method() === 'POST') {
        clicks.push(route.request().postDataJSON().category);
        counts = { ...counts, doner: 200, falafel: 150 };
      }
      await route.fulfill({ json: { counts } });
    });
    await page.goto('/');
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier', 'Pizza']);
    expect(clicks).toEqual([]);
    await expect(page.locator('#toolbar-toggle')).toHaveCount(0);
    await page.getByRole('button', { name: 'Weitere Kategorien', exact: true }).click();
    await expect(page.locator('#additional-categories button:visible')).toHaveText(['Döner', 'Falafel']);
    await expect(page.locator('#search')).toBeVisible();
    await expect(page.locator('#coffeeType')).toBeVisible();
    const menu = await page.locator('#additional-categories').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/wobillig-categories-${width}.png` });
    await page.getByRole('button', { name: 'Döner · Bald verfügbar' }).click();
    await expect(page.getByRole('dialog', { name: 'Döner · Bald verfügbar' })).toBeVisible();
    await expect.poll(() => clicks).toEqual(['doner']);
    await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier', 'Pizza']);
    expect(clicks).toEqual(['doner']);
    await page.getByRole('button', { name: 'Schliessen', exact: true }).click();
    await expect(page.locator('#categories-toggle')).toBeFocused();
    await expect(page.locator('#drink-doner')).toBeHidden();
    await expect(page.locator('#drink-falafel')).toBeHidden();
    await page.locator('#categories-toggle').click();
    await expect(page.locator('#additional-categories button:visible')).toHaveText(['Döner', 'Falafel']);
    await page.keyboard.press('Escape');
    await page.locator('#drink-pizza').click();
    await expect(page.locator('#map-title')).toHaveText('Pizzapreise Zürich');
    await expect(page.locator('#drink-pizza')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#categories-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#categories-toggle')).toHaveAccessibleName('Weitere Kategorien');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    // Even in a city without Pizza, popular upcoming categories stay in More.
    const other = await context.newPage();
    await other.route('**/data/bern/pizza.json', route => route.fulfill({ json: {
      bars: [], generatedAt: '2026-10-20', discoveredAt: '2026-10-20', attribution: '',
    } }));
    await other.goto('/bern');
    await expect(other.locator('#count')).not.toHaveText('Laden …');
    await expect(other.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier']);
    await expect(other.locator('#drink-doner')).toBeHidden();
    await expect(other.locator('#drink-falafel')).toBeHidden();
  });
}

test('keyboard, outside click and English menu work when popularity storage fails', async ({ page }) => {
  await page.route('**/api/categories', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/en');
  await expect(page.locator('#count')).not.toHaveText('Loading …');
  const toggle = page.getByRole('button', { name: 'More categories', exact: true });
  await toggle.focus();
  await toggle.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Doner kebab · Coming soon' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#additional-categories')).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator('#search').click();
  await expect(page.locator('#additional-categories')).toBeHidden();
  await page.locator('#drink-beer').click();
  await expect(page.locator('#drink-beer')).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await page.getByRole('button', { name: 'Falafel · Coming soon' }).click();
  await expect(page.getByRole('dialog')).toContainText('Prices are not available for this category yet.');
});

test('a delayed ranking does not move buttons while the menu is open', async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/categories', async route => {
    await wait;
    await route.fulfill({ json: { counts: { ...emptyCategoryCounts(), doner: 100 } } });
  });
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await page.locator('#categories-toggle').click();
  const response = page.waitForResponse('**/api/categories');
  release();
  await response;
  await expect(page.locator('#additional-categories button:visible')).toHaveText(['Döner', 'Falafel']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier', 'Pizza']);
  await expect(page.locator('#drink-doner')).toBeHidden();
  await expect(page.locator('#drink-falafel')).toBeHidden();
});
