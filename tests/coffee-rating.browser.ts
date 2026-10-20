import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';
import { captureAnalytics } from './analytics-browser-helper';

const coffee = JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset;
const venue = coffee.bars.find(bar => bar.id === 'node/1360776653')!;

for (const width of [320, 1280]) {
  test(`coffee rating is small, shared, editable and survives reload at ${width}px`, async ({ page }) => {
    await captureAnalytics(page);
    await page.setViewportSize({ width, height: 900 });
    let rating: { average: number; count: number } | undefined;
    const tokens: string[] = [];
    let fail = false;
    await page.route('**/api/prices?*', async route => {
      if (route.request().method() === 'POST') {
        if (fail) return route.fulfill({ status: 503, json: {} });
        const body = route.request().postDataJSON();
        expect(body.action).toBe('rateCoffee');
        expect(body.barId).toBe(venue.id);
        tokens.push(body.voterToken);
        rating = { average: body.score, count: 1 };
        return route.fulfill({ json: { rating } });
      }
      return route.fulfill({ json: { entries: [], coffeeRatings: rating ? { [venue.id]: rating } : {} } });
    });
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
    await page.goto(`/en?drink=coffee&coffeeType=espresso&bar=${encodeURIComponent(venue.id)}`);
    const detail = page.locator('#detail');
    const toggle = detail.getByRole('button', { name: 'Rate coffee', exact: true });
    await expect(toggle).toBeVisible();
    await expect(detail.locator('.coffee-rating-summary')).toHaveCount(0);
    await expect(detail.locator('#coffee-rating-editor')).toBeHidden();
    await toggle.click();
    await detail.getByRole('button', { name: '4 out of 5 stars' }).click();
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('★ 4.0/5 · 1');
    await expect(detail.getByRole('status')).toHaveText('Thanks for your rating.');
    await expect(detail.locator('#coffee-rating-editor')).toBeHidden();
    await page.reload();
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('★ 4.0/5 · 1');
    await toggle.click();
    await detail.getByRole('button', { name: '2 out of 5 stars' }).click();
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('★ 2.0/5 · 1');
    expect(tokens[1]).toBe(tokens[0]);
    await page.screenshot({ path: `/tmp/wobillig-coffee-rating-saved-${width}.png` });
    fail = true;
    await toggle.click();
    await detail.getByRole('button', { name: '5 out of 5 stars' }).click();
    await expect(detail.getByRole('alert')).toHaveText('Rating was not saved. Please try again.');
    await expect(detail.locator('.coffee-rating-summary')).toHaveText('★ 2.0/5 · 1');
    expect(await detail.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/wobillig-coffee-rating-${width}.png` });
    await page.goto(`/en?drink=beer&bar=${encodeURIComponent(venue.id)}`);
    await expect(page.locator('#detail')).toBeVisible();
    await expect(toggle).toHaveCount(0);
  });
}
