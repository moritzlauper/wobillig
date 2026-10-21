import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: { entries: [], counts: {}, enabled: false } }));
});

for (const width of [320, 1280]) {
  test(`cheap choice persists and shared links take priority at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const cheap = page.locator('#cheap');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await expect(cheap).toContainText('Günstig bis CHF');
    await expect(page.locator('#show-all')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('#show-all').click();
    await expect(cheap).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#show-all')).toBeHidden();
    await expect(page).toHaveURL(/cheap=0/);
    await page.goto('/');
    await expect(cheap).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/en/bern?cheap=1');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Show all', exact: true })).toBeVisible();
    // Merely opening a shared link does not change the saved preference.
    await page.goto('/');
    await expect(cheap).toHaveAttribute('aria-pressed', 'false');
    await cheap.click();
    await page.goto('/');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/?max=8');
    await expect(cheap).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#price')).toHaveValue('8');
  });
}

test('cheap mode works when browser storage is blocked and can be removed without prices', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.route('**/data/coffee.json', route => route.fulfill({ json: { bars: [], generatedAt: '', discoveredAt: '', attribution: '' } }));
  await page.goto('/');
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#show-all').click();
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'false');
});
