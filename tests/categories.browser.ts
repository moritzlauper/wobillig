import { test, expect } from '@playwright/test';
import { emptyCategoryCounts } from '../src/categories';

test.beforeEach(async ({ context }) => {
  await context.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  // Burger, ramen and gastro datasets are published by their scans; the category counts here must not depend on them.
  for (const dataset of ['burger', 'ramen', 'gastro-softdrink', 'gastro-cocktail', 'locations']) {
    await context.route(`**/data/${dataset}.json`, route => route.fulfill({ json: { bars: [] } }));
  }
  for (const foodType of ['doner', 'falafel'] as const) {
    await context.route(`**/data/**${foodType}.json`, route => route.fulfill({ json: streetfood(foodType, 3) }));
  }
});

// Imbiss stands with one priced Dürüm each, as published by the döner and falafel scan.
function streetfood(foodType: 'doner' | 'falafel', venues: number) {
  return { generatedAt: '', discoveredAt: '', attribution: '', bars: Array.from({ length: venues }, (_, index) => ({
    id: `node/${foodType}-${index}`, name: `${foodType} ${index}`, type: 'fast_food', lat: 47.378, lon: 8.53 + index * .002,
    address: 'Testgasse 1', postcode: '8005', website: null, openingHours: null, outdoor: false, scrapeStatus: 'prices_found', checkedAt: null,
    offers: [{ name: 'Dürüm', foodType, portionType: 'wrap', priceChf: 12 + index, volumeMl: null, alcoholFree: true, confidence: 'ai', observedAt: '2026-10-30', sourceUrl: '', evidence: '' }],
  })) };
}

// Kebab & Falafel opens once three stands have a price, counting both datasets together.
for (const [doner, falafel, visible] of [[1, 1, false], [2, 1, true], [0, 3, true]] as const) {
  test(`Kebab & Falafel needs three priced stands: ${doner} kebab, ${falafel} falafel`, async ({ page }) => {
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: { kebab: 9999 } } }));
    for (const [foodType, count] of [['doner', doner], ['falafel', falafel]] as const) {
      await page.route(`**/data/${foodType}.json`, route => route.fulfill({ json: streetfood(foodType, count) }));
    }
    const loaded = Promise.all(['doner', 'falafel'].map(category => page.waitForResponse(`**/data/${category}.json`)));
    await page.goto('/');
    await loaded;
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    await expect(page.locator('#primary-categories #drink-kebab')).toHaveCount(0);
    if (visible) {
      await page.locator('#categories-toggle').click();
      await expect(page.locator('#additional-categories button:visible')).toHaveText(['Kebab & Falafel']);
    } else {
      await expect(page.locator('#categories-toggle')).toBeHidden();
      await expect(page.locator('#drink-kebab')).toBeHidden();
    }
  });
}

test('missing or unreadable city datasets keep unavailable categories hidden', async ({ page }) => {
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: { kebab: 9999 } } }));
  await page.route('**/data/bern/doner.json', route => route.fulfill({ status: 404 }));
  await page.route('**/data/bern/falafel.json', route => route.fulfill({ contentType: 'text/html', body: '<html>Not found</html>' }));
  const loaded = Promise.all(['doner', 'falafel'].map(category => page.waitForResponse(`**/data/bern/${category}.json`)));
  await page.goto('/bern');
  await loaded;
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await expect(page.locator('#categories-toggle')).toBeHidden();
  await expect(page.locator('#drink-kebab')).toBeHidden();
  await expect(page.locator('#create-map')).toBeVisible();
});

for (const width of [320, 390, 1280]) {
  test(`Kebab & Falafel stays in More regardless of popularity at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    let counts = { coffee: 100, beer: 80, pizza: 5, kebab: 4 };
    const clicks: string[] = [];
    await context.route('**/api/categories', async route => {
      if (route.request().method() === 'POST') {
        clicks.push(route.request().postDataJSON().category);
        counts = { ...counts, kebab: 200 };
      }
      await route.fulfill({ json: { counts } });
    });
    await page.goto('/');
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Pizza', 'Bier']);
    expect(clicks).toEqual([]);
    await expect(page.locator('#toolbar-toggle')).toHaveCount(0);
    await page.getByRole('button', { name: 'Weitere Kategorien', exact: true }).click();
    await expect(page.locator('#additional-categories button:visible')).toHaveText(['Kebab & Falafel']);
    // On phones the venue search sits behind Filter.
    await expect(page.locator('#search')).toBeVisible({ visible: width >= 760 });
    await expect(page.locator('#coffeeType')).toBeVisible();
    const menu = await page.locator('#additional-categories').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/wobillig-categories-${width}.png` });
    await page.getByRole('button', { name: 'Kebab & Falafel', exact: true }).click();
    await expect(page.locator('#map-title')).toHaveText('Kebab- und Falafelpreise Zürich');
    await expect(page.locator('#streetfood-portion')).toHaveValue('snack');
    // Cheap mode opens on the cheaper stands of both kebab and falafel.
    await expect(page.locator('#results .venue').first()).toContainText('Dürüm');
    await expect.poll(() => clicks).toEqual(['kebab']);
    // However often it is clicked, Kebab & Falafel stays behind "Weitere".
    await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Pizza', 'Bier']);
    await expect(page.locator('#categories-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#categories-toggle').click();
    await expect(page.locator('#additional-categories button:visible')).toHaveText(['Kebab & Falafel']);
    await page.keyboard.press('Escape');
    await page.locator('#drink-pizza').click();
    await expect(page.locator('#map-title')).toHaveText('Pizzapreise Zürich');
    await expect(page.locator('#drink-pizza')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#categories-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#categories-toggle')).toHaveAccessibleName('Weitere Kategorien');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    // Even in a city without Pizza and without kebab prices, popular categories do not move up.
    const other = await context.newPage();
    await other.route('**/data/bern/pizza.json', route => route.fulfill({ json: {
      bars: [], generatedAt: '2026-10-20', discoveredAt: '2026-10-20', attribution: '',
    } }));
    await other.goto('/bern');
    await expect(other.locator('#count')).not.toHaveText('Laden …');
    await expect(other.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier']);
    await expect(other.locator('#drink-kebab')).toBeHidden();
  });
}

test('keyboard, outside click and English menu work when popularity storage fails', async ({ page }) => {
  await page.route('**/api/categories', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/en');
  await expect(page.locator('#count')).not.toHaveText('Loading …');
  const toggle = page.getByRole('button', { name: 'More categories', exact: true });
  await toggle.focus();
  await toggle.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Kebab & falafel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#additional-categories')).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator('#city-average').click();
  await expect(page.locator('#additional-categories')).toBeHidden();
  await page.locator('#drink-beer').click();
  await expect(page.locator('#drink-beer')).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await page.getByRole('button', { name: 'Kebab & falafel', exact: true }).click();
  await expect(page.locator('#map-title')).toContainText('Kebab and falafel prices');
});

test('a delayed ranking does not move buttons while the menu is open', async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/categories', async route => {
    await wait;
    await route.fulfill({ json: { counts: { ...emptyCategoryCounts(), kebab: 100 } } });
  });
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await page.locator('#categories-toggle').click();
  const response = page.waitForResponse('**/api/categories');
  release();
  await response;
  await expect(page.locator('#additional-categories button:visible')).toHaveText(['Kebab & Falafel']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Pizza', 'Bier']);
  await expect(page.locator('#drink-kebab')).toBeHidden();
});
