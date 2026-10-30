import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: { entries: [], counts: {}, enabled: false } }));
});

for (const width of [320, 1280]) {
  test(`plain visits start cheap and shared links take priority at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const cheap = page.locator('#cheap');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await expect(cheap).toContainText('Bis CHF');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    // The default view is shared as a plain link, also from older cheap=1 links.
    await page.goto('/?cheap=1');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(page.locator('a[data-city="bern"]')).toHaveAttribute('href', '/bern');
    await cheap.click();
    await expect(cheap).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => new URL(page.url()).search).toBe('?cheap=0');
    await expect(page.locator('a[data-city="bern"]')).toHaveAttribute('href', '/bern?cheap=0');
    // The choice stays in the link, but a plain visit starts cheap again.
    await page.reload();
    await expect(cheap).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/en/bern?cheap=1');
    await expect(cheap).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cheap')).toHaveAttribute('title', 'Remove the cheap filter');
    await page.goto('/?max=8');
    await expect(cheap).toHaveAttribute('aria-pressed', 'false');
    await expect(cheap).toHaveText(/Bis CHF/);
  });
}

test('a choice saved by an earlier version no longer switches cheap off', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wobillig:cheap', '0'));
  await page.goto('/');
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'true');
});

test('cheap mode works when browser storage is blocked and can be removed without prices', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.route('**/data/coffee.json', route => route.fulfill({ json: { bars: [], generatedAt: '', discoveredAt: '', attribution: '' } }));
  await page.goto('/');
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#cheap').click();
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('#cheap')).toHaveAttribute('aria-pressed', 'false');
});
