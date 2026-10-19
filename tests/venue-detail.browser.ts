import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';
import { captureAnalytics } from './analytics-browser-helper';

const coffee = JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset;
const venue = coffee.bars.find(bar => bar.id === 'node/1360776653')!;

for (const width of [320, 1280]) {
  test(`venue details keep catalogue addresses and provide Google Maps at ${width}px`, async ({ page }) => {
    await captureAnalytics(page);
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
    let hasAddress = true;
    await page.route('**/data/*.json', route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      const bars = name === 'coffee.json' ? [{ ...venue, address: '', postcode: '' }]
        : name === 'locations.json' ? [{ ...venue, address: hasAddress ? venue.address : '', offers: [] }] : [];
      return route.fulfill({ json: { ...coffee, bars } });
    });
    await page.goto('/en?drink=coffee&coffeeType=espresso&bar=node%2F1360776653');
    const detail = page.locator('#detail');
    await expect(detail).toContainText('Kasernenareal / Zeughaushof 8004 Zurich');
    const maps = detail.getByRole('link', { name: 'Open in Google Maps' });
    await expect(maps).toBeVisible();
    expect(new URL((await maps.getAttribute('href'))!).searchParams.get('query')).toContain(venue.address);
    await expect(maps).toHaveAttribute('target', '_blank');
    expect(await detail.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/wobillig-venue-detail-${width}.png` });
    hasAddress = false;
    await page.reload();
    await expect(detail).toContainText('8004 · Zurich · Location:');
    await expect(detail).not.toContainText('Address not yet recorded');
    expect(new URL((await maps.getAttribute('href'))!).searchParams.get('query')).toBe(`${venue.lat},${venue.lon}`);
  });
}
