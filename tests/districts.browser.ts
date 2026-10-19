import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Dataset } from '../src/data';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('https://gc.zgo.at/**', route => route.abort());
});

for (const [path, toggle, param, name] of [
  ['/basel', 'Wohnviertel anzeigen', 'quartier', 'Altstadt Grossbasel'],
  ['/bern', 'Stadtteile anzeigen', 'stadtteil', 'Innere Stadt'],
] as const) {
  test(`${path} filters by its official districts and restores them from the link`, async ({ page }) => {
    await page.goto(path);
    await page.locator('#filters-toggle').click();
    await page.getByLabel(toggle).check();
    await expect(page.locator('.leaflet-districts-pane path').first()).toBeVisible();
    await page.locator('#district-select').selectOption('1');
    await expect(page.locator('#district-average')).toContainText(`Schnitt ${name} CHF`);
    await expect(page).toHaveURL(new RegExp(`${param}=1`));
    await page.reload();
    await expect(page.locator('#district-select')).toHaveValue('1');
    await expect(page.locator('#district-average')).toContainText(name);
  });
}

test('Basel venues show their official boulevard permit', async ({ page }) => {
  const coffee = JSON.parse(readFileSync(new URL('../public/data/basel/coffee.json', import.meta.url), 'utf8')) as Dataset;
  const venue = coffee.bars.find(b => b.outdoorPermit?.season === 'year' && b.offers.length);
  expect(venue).toBeDefined();
  await page.goto(`/basel?drink=coffee&bar=${encodeURIComponent(venue!.id)}`);
  await expect(page.locator('#detail')).toContainText('Boulevard bewilligt, ganzjährig');
});
