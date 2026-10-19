import { test, expect } from '@playwright/test';

const address = { attrs: { label: 'Bümplizstrasse 97a <b>3018 Bern</b>', lat: 46.943485, lon: 7.39179, origin: 'address' } };
const endpoint = 'https://api3.geo.admin.ch/**';
test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route(endpoint, route => route.fulfill({ json: { results: [address] } }));
  await page.goto('/bern');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
});

test('selects a residential address by keyboard, shows nearby venues and restores it after reload', async ({ page }) => {
  const search = page.getByRole('combobox', { name: 'Lokal oder Adresse suchen' });
  await search.fill('Buemplizstr.97 a');
  await expect(page.getByRole('option', { name: /Bümplizstrasse 97a.*Adresse \/ Ort/ })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(search).toHaveValue('Bümplizstrasse 97a 3018 Bern');
  await expect(page.locator('#sort')).toHaveValue('distance');
  await expect(page.locator('#results .venue').first()).toBeAttached();
  await expect(page.locator('.leaflet-tooltip')).toHaveText('Bümplizstrasse 97a 3018 Bern');
  await expect(page.locator('#search-dropdown')).toBeHidden();
  await page.reload();
  await expect(page.locator('.leaflet-tooltip')).toHaveText('Bümplizstrasse 97a 3018 Bern');
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.leaflet-tooltip')).toHaveCount(0);
  await expect(page.locator('#sort')).toHaveValue('price');
});

test('Enter waits for the address lookup; click and touch selection work', async ({ page }) => {
  const search = page.locator('#search');
  await search.fill('Bümplizstrasse 97a');
  await search.press('Enter');
  await expect(page.locator('#count')).toContainText('Bezugspunkt: Bümplizstrasse 97a');
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await search.fill('97a Bümplizstrasse');
  await page.getByRole('option', { name: /Bümplizstrasse 97a.*Adresse \/ Ort/ }).tap();
  await expect(page.locator('#count')).toContainText('Bezugspunkt: Bümplizstrasse 97a');
});

test('shows errors and allows retry without losing local search', async ({ page }) => {
  await page.route(endpoint, route => route.abort());
  await page.locator('#search').fill('Bümplizstrasse 97a');
  await expect(page.locator('#search-empty')).toContainText('gerade nicht verfügbar');
  await page.route(endpoint, route => route.fulfill({ json: { results: [address] } }));
  await page.locator('#search').press('Enter');
  await expect(page.locator('#count')).toContainText('Bezugspunkt: Bümplizstrasse 97a');
});

test('discarded requests cannot reopen the dropdown or move the map', async ({ page }) => {
  let requested = false;
  await page.route(endpoint, async route => {
    requested = true;
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.fulfill({ json: { results: [address] } }).catch(() => {});
  });
  await page.locator('#search').fill('Bümplizstrasse 97a');
  await page.locator('#search').press('Enter');
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#search-dropdown')).toBeHidden();
  await expect(page.locator('#count')).not.toContainText('Bezugspunkt');
});
