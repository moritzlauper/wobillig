import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('https://gc.zgo.at/**', route => route.abort());
});

async function theme(page: Page, value: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await expect(page.locator('html')).toHaveCSS('color-scheme', value);
  await expect(page.locator('html')).toHaveCSS('background-color', value === 'dark' ? 'rgb(25, 29, 34)' : 'rgb(255, 255, 255)');
}

test('system changes are live; explicit choices persist across reloads, cities and guides', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await theme(page, 'dark');
  await expect(page.getByLabel('Farbschema')).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme(page, 'light');
  await page.getByLabel('Farbschema').selectOption('dark');
  await page.reload();
  await theme(page, 'dark');
  for (const path of ['/bern', '/basel', '/espresso-zuerich', '/cappuccino-zuerich', '/espresso-bern', '/cappuccino-bern', '/espresso-basel', '/cappuccino-basel']) {
    await page.goto(path);
    await theme(page, 'dark');
    await expect(page.getByLabel('Farbschema')).toHaveValue('dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#191d22');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await page.getByLabel('Farbschema').selectOption('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme(page, 'light');
  await page.getByLabel('Farbschema').selectOption('system');
  await theme(page, 'dark');
  expect(await page.evaluate(() => localStorage.getItem('wobillig-theme'))).toBeNull();
});

test('theme changes sync across tabs, including returning to system', async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem('wobillig-theme', 'light'));
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/espresso-bern');
  await page.getByLabel('Farbschema').selectOption('dark');
  await theme(other, 'dark');
  await other.getByLabel('Farbschema').selectOption('system');
  await expect(page.getByLabel('Farbschema')).toHaveValue('system');
});

test('blocked storage does not prevent switching or loading the map', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByLabel('Farbschema').selectOption('dark');
  await theme(page, 'dark');
  await expect(page.locator('.price-marker').first()).toBeVisible();
});

test('invalid preferences fall back to system and guides work without JavaScript', async ({ page, browser }) => {
  await page.addInitScript(() => localStorage.setItem('wobillig-theme', 'invalid'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await theme(page, 'dark');
  await expect(page.getByLabel('Farbschema')).toHaveValue('system');
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark', viewport: { width: 320, height: 700 } });
  const guide = await context.newPage();
  await guide.goto('http://127.0.0.1:5179/espresso-zuerich');
  await expect(guide.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(guide.locator('html')).toHaveCSS('background-color', 'rgb(25, 29, 34)');
  await expect(guide.locator('h1')).toBeVisible();
  await expect(guide.getByLabel('Farbschema')).toBeHidden();
  await context.close();
});

for (const mode of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1440]) {
    test(`${mode} at ${width}px: map, search, filters, details and dialogs`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: mode });
      await page.goto('/');
      await theme(page, mode);
      await expect(page.locator('.price-marker').first()).toBeVisible();
      await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('filter', mode === 'light' ? 'none' : 'invert(1) hue-rotate(180deg) brightness(0.78) saturate(0.55)');
      await page.screenshot({ path: `/tmp/wobillig-theme-${mode}-${width}.png` });
      if (width < 760) {
        await page.locator('#categories-toggle').click();
        await expect(page.locator('#additional-categories')).toBeVisible();
        await expect(page.locator('#search')).toBeVisible();
        await expect(page.getByLabel('Farbschema')).toBeVisible();
        await page.locator('#categories-toggle').click();
        await page.locator('#view-list').click();
        await expect(page.locator('.venue').first()).toBeVisible();
        await page.locator('#view-map').click();
      }
      await page.locator('#filters-toggle').click();
      await expect(page.locator('#filters')).toBeVisible();
      await page.locator('#search').fill('Mars');
      await expect(page.locator('#search-suggestions button').first()).toBeVisible();
      await page.locator('#search').press('ArrowDown');
      await page.locator('#search').press('Enter');
      await expect(page.locator('#detail')).toBeVisible();
      await expect(page.locator('#detail')).toHaveCSS('background-color', mode === 'dark' ? 'rgb(25, 29, 34)' : 'rgb(255, 255, 255)');
      await page.locator('#add-here').click();
      await expect(page.locator('#price-dialog')).toBeVisible();
      await expect(page.locator('#price-dialog')).toHaveCSS('background-color', mode === 'dark' ? 'rgb(25, 29, 34)' : 'rgb(255, 255, 255)');
      await page.locator('#manual-entry > summary').click();
      await expect(page.locator('#entry-price')).toBeVisible();
      await page.screenshot({ path: `/tmp/wobillig-theme-form-${mode}-${width}.png` });
      await page.locator('#cancel-price').click();
      await page.locator('#data-info').click();
      await expect(page.locator('#info')).toBeVisible();
      await page.locator('#close-info').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(errors).toEqual([]);
    });
  }
}

test('district boundaries adapt immediately when the theme changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.locator('#filters-toggle').click();
  await page.locator('#district-toggle').check();
  const boundary = page.locator('.leaflet-districts-pane path').first();
  await expect(boundary).toBeVisible();
  await expect(boundary).toHaveCSS('stroke', 'rgb(82, 123, 166)');
  await page.getByLabel('Farbschema').selectOption('dark');
  await expect(boundary).toHaveCSS('stroke', 'rgb(143, 180, 220)');
  await page.locator('#district-select').selectOption('1');
  await expect(page.locator('#district-average')).toBeVisible();
});
