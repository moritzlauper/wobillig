import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';
import { captureAnalytics } from './analytics-browser-helper';
const pizza = JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset;
const venue = pizza.bars.find(bar => bar.name === '60 Seconds to Napoli')!;
const url = `/en?drink=pizza&bar=${encodeURIComponent(venue.id)}`;
const rating = { rating: 4.5, reviewCount: 123, mapsUrl: 'https://maps.google.com/?cid=123', attributions: [] };
test.beforeEach(async ({ page }) => {
  await captureAnalytics(page);
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
});
for (const width of [320, 1280]) {
  test(`loads the rating beside Google Maps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    await page.route('**/api/google-rating?*', route => { requests++; return route.fulfill({ json: { rating } }); });
    await page.goto(url);
    const text = page.locator('.detail-rating');
    await expect(text).toHaveText('4.5/5');
    await expect(text).toHaveAttribute('title', '123 Google reviews');
    await expect(page.locator('.detail-maps > a')).toHaveAttribute('href', rating.mapsUrl);
    const sizes = await page.locator('.detail-maps').evaluate(el => [...el.children].map(child => getComputedStyle(child).fontSize));
    expect(sizes[0]).toBe(sizes[1]);
    expect(await page.locator('#detail').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.locator('#sort').selectOption('name', { force: true });
    await expect(text).toHaveText('4.5/5');
    expect(requests).toBe(1);
  });
}
test('keeps the Maps link usable when Google is unavailable', async ({ page }) => {
  await page.route('**/api/google-rating?*', route => route.fulfill({ status: 503, json: {} }));
  await page.goto(url);
  await expect(page.locator('.detail-maps > a')).toBeVisible();
  await expect(page.locator('.detail-rating')).toHaveCount(0);
  await expect(page.locator('.detail-maps > a')).toHaveAttribute('href', /google.com\/maps\/search/);
});
test('does not request a Google rating for an ordinary cafe', async ({ page }) => {
  const coffee = JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset;
  const cafe = coffee.bars.find(bar => bar.offers.length && !pizza.bars.some(p => p.id === bar.id))!;
  let requests = 0;
  await page.route('**/api/google-rating?*', route => { requests++; return route.fulfill({ json: { rating } }); });
  await page.goto(`/en?drink=coffee&bar=${encodeURIComponent(cafe.id)}`);
  await expect(page.locator('.detail-maps > a')).toBeVisible();
  expect(requests).toBe(0);
  await expect(page.locator('.detail-rating')).toHaveCount(0);
});

test('creates no rating element or replacement text when no rating is available', async ({ page }) => {
  await page.route('**/api/google-rating?*', route => route.fulfill({ json: { rating: null } }));
  const response = page.waitForResponse('**/api/google-rating?*');
  await page.goto(url); await response;
  await expect(page.locator('.detail-maps')).toHaveText('Google Maps');
  await expect(page.locator('.detail-rating')).toHaveCount(0);
});
