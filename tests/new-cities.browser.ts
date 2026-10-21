import { test, expect } from '@playwright/test';
import { captureAnalytics } from './analytics-browser-helper';

test.beforeEach(async ({ page }) => {
  await captureAnalytics(page);
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [], venues: [], coffeeRatings: {} } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.route('**/api/tip?*', route => route.fulfill({ status: 503, json: {} }));
});

test('Geneva includes cafes and bars in Carouge', async ({ page }) => {
  for (const [drink, id, name] of [
    ['coffee', 'node/6312663914', 'Blue Balloon Café'],
    ['beer', 'node/5860680786', 'Bar du Nord'],
  ]) {
    await page.goto(`/en/geneve?drink=${drink}&bar=${encodeURIComponent(id)}`);
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('#detail')).toContainText(name);
    await expect(page.locator('#detail')).toContainText('1227');
  }
});

for (const width of [320, 1280]) {
  test(`compact city menu, English defaults and city requests at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/basel?drink=beer&size=500');
    const menu = page.locator('#city-more');
    await expect(menu.locator('a[data-city]').first()).toBeHidden();
    await menu.locator('summary').click();
    await expect(menu.locator('a[data-city="lausanne"]')).toBeVisible();
    await expect(menu.locator('a[data-city="geneva"]')).toHaveAttribute('href', /\/en\/geneve\?.*drink=beer/);
    await expect(menu.locator('a').last()).toHaveAttribute('href', /^mailto:hello@wobillig.ch\?subject=/);
    await expect(menu.locator('a').last()).toHaveAccessibleName('Stadt wünschen');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('open', '');
    await menu.locator('summary').click();
    await menu.locator('a[data-city="lausanne"]').click();
    await expect(page).toHaveURL(/\/en\/lausanne\?.*drink=beer/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#map-title')).toContainText('Lausanne');
    await page.locator('#city-more summary').click();
    await page.locator('#city-more a[data-city="geneva"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#map-title')).toContainText('Geneva');
    await page.locator('.seo-map-header [data-locale="de"]').click();
    await expect(page).toHaveURL(/\/de\/geneve\?/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-CH');
    await expect(page.locator('#count')).not.toContainText('Laden');
    await page.locator('#city-more summary').click();
    await page.screenshot({ path: `/tmp/wobillig-cities-${width}.png` });
  });
}

for (const [city, param, number, name] of [
  ['lausanne', 'quartierLausanne', '90', 'Zones foraines'],
  ['geneve', 'quartierGeneve', '4', 'Eaux-Vives Cité'],
]) {
  test(`${city} direct links default to English and restore the official districts`, async ({ page }) => {
    await page.goto(`/${city}?${param}=${number}`);
    await expect(page).toHaveURL(new RegExp(`/en/${city}\\?`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('#filters-toggle').click();
    await expect(page.locator('#district-select')).toHaveValue(number);
    await expect(page.locator('#district-select option:checked')).toContainText(name);
    await expect(page.locator('.leaflet-districts-pane path').first()).toBeAttached();
    await page.reload();
    await expect(page.locator('#district-select')).toHaveValue(number);
  });
}
