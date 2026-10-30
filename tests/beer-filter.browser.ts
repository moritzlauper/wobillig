import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';
import { captureAnalytics } from './analytics-browser-helper';

for (const [width, language] of [[320, 'de'], [1280, 'en']] as const) {
  test(`beer dropdown and search stay inside filters at ${width}px in ${language}`, async ({ page }) => {
    const data = JSON.parse(readFileSync('public/data/bars.json', 'utf8')) as Dataset;
    const source = data.bars.flatMap(bar => bar.offers).find(offer => !offer.alcoholFree)!;
    const lager = { ...source, name: 'Lager', volumeMl: 300, beerType: 'draft' as const, priceChf: 4, photoSource: undefined };
    data.bars = data.bars.slice(0, 4).map((bar, index) => ({
      ...bar, type: 'bar', offers: index === 0 ? [lager,
        { ...lager, name: 'Guinness Draught', volumeMl: 568, priceChf: 9 },
        { ...lager, name: 'Appenzeller Quöllfrisch Naturtrüb', volumeMl: 500, priceChf: 7 }]
        : index === 1 ? [lager, { ...lager, name: 'Quöllfrisch Hell', volumeMl: 330, priceChf: 6.5 }]
          : index === 2 ? [lager] : [],
    }));
    await captureAnalytics(page);
    await page.route('**/data/bars.json', route => route.fulfill({ json: data }));
    await page.route('**/data/coffee.json', route => route.fulfill({ json: { ...data, bars: [] } }));
    await page.route('**/data/pizza.json', route => route.fulfill({ json: { ...data, bars: [] } }));
    // Without this, the location catalogue of all Zürich venues would appear in the beer list.
    await page.route('**/data/locations.json', route => route.fulfill({ json: { bars: [] } }));
    await page.route('**/data/burger.json', route => route.fulfill({ json: { bars: [] } }));
    await page.route('**/data/ramen.json', route => route.fulfill({ json: { bars: [] } }));
    await page.route('**/data/gastro-*.json', route => route.fulfill({ json: { bars: [] } }));
    await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${language === 'en' ? '/en' : '/'}?drink=beer&cheap=0`);
    await expect(page.locator('#results .venue')).toHaveCount(4);
    await expect(page.locator('#beer-query')).toBeHidden();
    await expect(page.locator('#beer-selection')).toBeHidden();
    await expect(page.locator('.toolbar #beer-query')).toHaveCount(0);
    await page.locator('#filters-toggle').click();
    await expect(page.locator('#filters #beer-query')).toHaveAttribute('placeholder', language === 'en' ? 'e.g. Quöllfrisch' : 'z. B. Quöllfrisch');
    await expect(page.locator('#beer-selection option')).toHaveText([language === 'en' ? 'All beers' : 'Alle Biere', 'Quöllfrisch', 'Guinness']);
    await page.locator('#beer-selection').selectOption('quollfrisch');
    await expect(page.locator('#results .venue')).toHaveCount(2);
    await expect(page.locator('#city-average')).toContainText('6.75');
    await expect(page.locator('.marker-wrap')).toHaveCount(2);
    await expect(page.locator('#volume')).toHaveValue('all');
    await page.reload();
    await expect(page.locator('#results .venue')).toHaveCount(2);
    await expect(page.locator('#beer-selection')).toHaveValue('quollfrisch');
    await expect(page.locator('#beer-selection')).toBeHidden();
    await page.locator('#filters-toggle').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole('searchbox', { name: language === 'en' ? 'Beer name or brand' : 'Biername oder Marke' }).fill('Guiness');
    await expect(page.locator('#beer-selection')).toHaveValue('all');
    await expect(page.locator('#volume')).toHaveValue('all');
    await expect(page.locator('#results .venue')).toHaveCount(1);
    await expect(page.locator('#results .venue')).toContainText('Guinness Draught');
    await expect(page.locator('#results .venue')).toContainText('9.00');
    await expect(page.locator('#city-average')).toContainText('9.00');
    await expect(page.locator('.marker-wrap')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#beer-query')).toHaveValue('Guiness');
    await expect(page.locator('#results .venue')).toHaveCount(1);
    await page.locator('.leaflet-control-zoom-in').click({ clickCount: 4, delay: 300 });
    await expect(page.locator('.location-marker')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('#volume').selectOption('300-330');
    await expect(page.locator('#results .venue')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#volume')).toHaveValue('300-330');
    await expect(page.locator('#results .venue')).toHaveCount(0);
    await page.locator('#filters-toggle').click();
    await page.locator('#beer-query').fill('no-such-beer');
    await expect(page.locator('.marker-wrap')).toHaveCount(0);
    await page.locator('#beer-selection').selectOption('quollfrisch');
    await expect(page.locator('#beer-query')).toHaveValue('');
    await expect(page.locator('#results .venue')).toHaveCount(2);
    await page.locator('#reset').click();
    await expect(page.locator('#beer-query')).toHaveValue('');
    await expect(page.locator('#beer-selection')).toHaveValue('all');
    await expect(page.locator('#results .venue')).toHaveCount(4);
    expect(new URL(page.url()).searchParams.has('beerQuery')).toBe(false);
    expect(new URL(page.url()).searchParams.has('beerSelection')).toBe(false);
    await page.locator('#drink-coffee').click();
    await expect(page.locator('#beer-selection-controls')).toBeHidden();
  });
}
