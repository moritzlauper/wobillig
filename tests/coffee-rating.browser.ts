import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';
import { captureAnalytics } from './analytics-browser-helper';

const coffee = JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset;
const venue = coffee.bars.find(bar => bar.id === 'node/1360776653')!;

for (const width of [320, 1280]) {
  test(`coffee rating requires a photo, survives reload and fits at ${width}px`, async ({ page }) => {
    await captureAnalytics(page);
    await page.setViewportSize({ width, height: 900 });
    let rating: { average: number | null; count: number } | undefined;
    let fail = false, writes = 0;
    await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [], coffeeRatings: rating ? { [venue.id]: rating } : {} } }));
    await page.route('**/api/coffee-rating?*', async route => {
      writes++;
      if (fail) return route.fulfill({ status: 429, json: { error: 'Du kannst deine Bewertung für dieses Lokal erst nach 12 Stunden wieder ändern.' } });
      const body = route.request().postDataJSON();
      expect(body.barId).toBe(venue.id);
      expect(body).not.toHaveProperty('voterToken');
      expect(body.image.mediaType).toBe('image/jpeg');
      expect(Buffer.from(body.image.data, 'base64').length).toBeLessThan(2_000_000);
      rating = { average: null, count: 1 };
      return route.fulfill({ json: { rating } });
    });
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
    await page.goto(`/en?drink=coffee&coffeeType=espresso&bar=${encodeURIComponent(venue.id)}`);
    const detail = page.locator('#detail');
    const toggle = detail.getByRole('button', { name: 'Rate coffee', exact: true });
    const save = detail.getByRole('button', { name: 'Save rating', exact: true });
    await expect(toggle).toBeVisible();
    await expect(detail.locator('#coffee-rating-editor')).toBeHidden();
    await toggle.click();
    await detail.getByRole('button', { name: '4 out of 5 stars' }).click();
    await expect(save).toBeDisabled(); expect(writes).toBe(0);
    await expect(detail.getByText('A coffee photo is enough. No receipt needed.')).toBeVisible();
    // The API is mocked: this fixture tests client compression, not image recognition.
    await detail.locator('.coffee-photo').setInputFiles('tests/fixtures/menu-scan-table.jpg');
    await expect(save).toBeEnabled(); await save.click();
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('Only a few ratings so far · 1');
    await expect(detail.locator('.coffee-rating-message')).toHaveText('Thanks for your rating.');
    await expect(detail.locator('#coffee-rating-editor')).toBeHidden();
    await page.reload();
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('Only a few ratings so far · 1');
    fail = true;
    await toggle.click();
    await detail.getByRole('button', { name: '2 out of 5 stars' }).click();
    await detail.locator('.coffee-photo').setInputFiles('tests/fixtures/menu-scan-table.jpg');
    await save.click();
    await expect(detail.getByRole('alert')).toHaveText('You can change your rating for this venue after 12 hours.');
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('Only a few ratings so far · 1');
    expect(await detail.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/wobillig-coffee-photo-${width}.png` });
    rating = { average: 4, count: 3 };
    await page.reload();
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('★ 4.0/5 · 3');
    await page.goto(`/en?drink=beer&bar=${encodeURIComponent(venue.id)}`);
    await expect(page.locator('#detail')).toBeVisible();
    await expect(toggle).toHaveCount(0);
  });
}
