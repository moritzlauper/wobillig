import { test, expect } from '@playwright/test';
import { emptyCategoryCounts } from '../src/categories';

test.beforeEach(async ({ context }) => {
  await context.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
});

for (const width of [320, 390, 1280]) {
  test(`More replaces the mobile collapse toggle and promotes Doner at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    let counts = { coffee: 100, beer: 80, pizza: 5, doner: 4, falafel: 0 };
    const clicks: string[] = [];
    await context.route('**/api/categories', async route => {
      if (route.request().method() === 'POST') {
        clicks.push(route.request().postDataJSON().category);
        counts = { ...counts, doner: 60 };
      }
      await route.fulfill({ json: { counts } });
    });
    await page.goto('/');
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier', 'Pizza Margherita']);
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
    await expect(page.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier', 'Döner']);
    expect(clicks).toEqual(['doner']);
    await page.getByRole('button', { name: 'Schliessen', exact: true }).click();
    await expect(page.locator('#drink-doner')).toBeFocused();
    await page.locator('#categories-toggle').click();
    await expect(page.locator('#additional-categories button:visible')).toHaveText(['Pizza Margherita', 'Falafel']);
    await page.locator('#drink-pizza').click();
    await expect(page.locator('#map-title')).toHaveText('Pizzapreise Zürich');
    await expect(page.locator('#categories-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#categories-toggle')).toHaveAccessibleName('Weitere Kategorien: Pizza Margherita');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    // The ranking is shared with a fresh page in another city, not local click history.
    const other = await context.newPage();
    await other.goto('/bern');
    await expect(other.locator('#primary-categories button')).toHaveText(['Kaffee', 'Bier', 'Döner']);
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
  await expect(page.locator('#primary-categories button')).toHaveText(['Döner', 'Kaffee', 'Bier']);
});
