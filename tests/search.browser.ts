import { test, expect } from '@playwright/test';
import { showSearch } from './search-row-helper';

const address = { attrs: { label: 'Bümplizstrasse 97a <b>3018 Bern</b>', lat: 46.943485, lon: 7.39179, origin: 'address' } };
const endpoint = 'https://api3.geo.admin.ch/**';
test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route(endpoint, route => route.fulfill({ json: { results: [address] } }));
  await page.goto('/bern');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await showSearch(page);
});

test('selects a residential address by keyboard, shows nearby venues and restores it after reload', async ({ page }) => {
  const search = page.getByRole('combobox', { name: 'Lokal oder Adresse suchen' });
  await search.fill('Buemplizstr.97 a');
  await expect(page.locator('#search-suggestions').getByRole('option', { name: /Bümplizstrasse 97a.*Adresse \/ Ort/ })).toBeVisible();
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
  await page.locator('#search-suggestions').getByRole('option', { name: /Bümplizstrasse 97a.*Adresse \/ Ort/ }).tap();
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

for (const width of [390, 1280]) {
  test(`typing and browsing suggestions leave the map still at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await showSearch(page);
    await expect(page.locator('#results .venue').first()).toBeAttached();
    const name = await page.locator('#results .venue strong').first().innerText();
    const mapState = () => page.evaluate(() => ({
      pane: document.querySelector<HTMLElement>('.leaflet-map-pane')!.style.transform,
      tiles: Array.from(document.querySelectorAll<HTMLImageElement>('.leaflet-tile')).map(tile => tile.src).sort(),
    }));
    await page.waitForTimeout(400);
    const before = await mapState();
    const search = page.locator('#search');
    for (const query of [name.slice(0, 2), name]) {
      await search.fill(query);
      await expect(page.locator('#search-empty')).toBeHidden();
      await page.waitForTimeout(500);
      expect(await mapState()).toEqual(before);
    }
    await search.press('ArrowDown');
    expect(await mapState()).toEqual(before);
    await search.press('Enter');
    await expect(page.locator('#detail')).toBeVisible();
    await expect.poll(mapState).not.toEqual(before);
  });
}

test('history survives reload, restores addresses without lookup and can be cleared', async ({ page }) => {
  const search = page.locator('#search');
  await search.fill('Bümplizstrasse 97a');
  await search.press('Enter');
  await expect(page.locator('.leaflet-tooltip')).toHaveCount(1);
  await expect(page.locator('.leaflet-tooltip')).toBeVisible();
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await expect(page.getByText('Letzte Suchen', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await showSearch(page);
  await page.route(endpoint, route => route.abort());
  await search.focus();
  await expect(page.locator('#search-suggestions').getByRole('option')).toHaveCount(1);
  await page.locator('#search-suggestions').getByRole('option', { name: /Bümplizstrasse 97a/ }).tap();
  await expect(page.locator('.leaflet-tooltip')).toHaveText('Bümplizstrasse 97a 3018 Bern');
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await expect(page.locator('#search-suggestions').getByRole('option')).toHaveCount(1);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.locator('.leaflet-tooltip')).toHaveCount(1);
  await expect(page.locator('.leaflet-tooltip')).toBeVisible();
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await search.press('Tab');
  await expect(page.getByRole('button', { name: 'Verlauf löschen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-dropdown')).toBeHidden();
  await page.reload();
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await showSearch(page);
  await search.focus();
  await expect(page.locator('#search-dropdown')).toBeHidden();
});

test('only selected venues are remembered and can be selected again', async ({ page }) => {
  const search = page.locator('#search');
  const name = await page.locator('#results .venue strong').first().innerText();
  await search.fill(name);
  await expect(page.locator('#search-suggestions').getByRole('option').first()).toContainText(name);
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await expect(page.locator('#search-dropdown')).toBeHidden();
  await search.fill(name);
  await search.press('Enter');
  await expect(page.locator('#detail')).toBeVisible();
  await page.getByRole('button', { name: 'Suche löschen' }).click();
  await expect(page.locator('#search-suggestions').getByRole('option')).toHaveCount(1);
  await expect(page.locator('#search-suggestions').getByRole('option')).toContainText(name);
  await page.locator('#search-suggestions').getByRole('option').click();
  await expect(search).toHaveValue(name);
  await expect(page.locator('#detail')).toBeVisible();
});


test('unrelated service suggestions are hidden and cannot be selected with Enter', async ({ page }) => {
  await page.route(endpoint, route => route.fulfill({ json: { results: [
    { attrs: { label: 'Bern (BE)', lat: 46.948, lon: 7.447, origin: 'gg25' } },
    { attrs: { label: 'Berna (BE)', lat: 46.948, lon: 7.447, origin: 'gg25' } },
    { attrs: { label: 'Muri bei Bern (BE)', lat: 46.93, lon: 7.49, origin: 'gg25' } },
  ] } }));
  const search = page.locator('#search');
  await search.fill('Pinprinzial');
  await expect(page.locator('#search-empty')).toContainText('Keine Lokale oder Adressen gefunden');
  await expect(page.locator('#search-suggestions').getByRole('option')).toHaveCount(0);
  await search.press('Enter');
  await expect(page.locator('#search-empty')).toContainText('Keine Lokale oder Adressen gefunden');
  await expect(page.locator('#count')).not.toContainText('Bezugspunkt');
  await expect(search).toHaveValue('Pinprinzial');
});
