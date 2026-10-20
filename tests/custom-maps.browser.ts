import { test, expect } from '@playwright/test';
import type { CustomMap } from '../src/custom-map-data';

const venue = { id: 'node/test-doner', name: 'Test Döner', address: 'Langstrasse 1', postcode: '8004', lat: 47.378, lon: 8.53,
  type: 'fast_food', offers: [], website: null, openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'unavailable' };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.route('**/data/locations.json', route => route.fulfill({ json: { bars: [venue] } }));
});

for (const width of [320, 1280]) {
  test(`public maps stay collapsed under More at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const saved: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Glace-Map', createdAt: new Date().toISOString(),
      entries: Array.from({ length: 5 }, (_, i) => ({ venue: { ...venue, id: `node/${i}` }, product: 'Glace', priceChf: 5, revision: 1, updatedAt: new Date().toISOString() })) };
    await page.route('**/api/prices?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('map')
      ? { map: saved } : { entries: [], publicMaps: [{ id: saved.id, name: saved.name, venueCount: 5 },
        { id: 'd268dbea-93cf-45de-9d17-2b5c74090237', name: 'Draft map', venueCount: 4 }] } }));
    await page.goto('/');
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    const shortcut = page.locator(`[data-custom-map="${saved.id}"]`);
    await expect(shortcut).toBeHidden();
    await expect(page.locator('#primary-categories [data-custom-map]')).toHaveCount(0);
    await page.locator('#categories-toggle').click();
    await expect(shortcut).toBeVisible();
    await expect(shortcut).toHaveText('Glace-Map · 5 Lokale');
    await expect(page.getByRole('button', { name: /Draft map/ })).toHaveCount(0);
    const menu = await page.locator('#additional-categories').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    await shortcut.click();
    await expect(page.locator('#custom-map-name')).toHaveText('Glace-Map');
    await expect(page.locator('#custom-map-visibility')).toHaveText('Öffentlich unter «Weitere» sichtbar.');
    await page.locator('#map-back').click();
    await expect(shortcut).toBeHidden();
    await page.reload();
    await expect(shortcut).toBeHidden();
    await page.locator('#categories-toggle').click();
    await expect(shortcut).toBeVisible();
  });
  test(`create, contribute, share, reload and reopen a map at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    let saved: CustomMap | undefined;
    await context.route('**/api/prices?*', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        if (body.action === 'createMap') saved = { id: body.mapId, name: body.name, createdAt: new Date().toISOString(), entries: [] };
        else if (body.action === 'saveMapEntry') saved!.entries = [{ venue, product: body.product, priceChf: body.priceChf, revision: body.revision + 1, updatedAt: new Date().toISOString() }];
        return route.fulfill({ json: { map: saved } });
      }
      return route.fulfill({ json: new URL(req.url()).searchParams.has('map') ? { map: saved } : { entries: [] } });
    });
    await page.goto('/');
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    await page.getByRole('button', { name: 'Map erstellen', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name der Map' }).fill('Döner-Map');
    await page.locator('#create-map-dialog').getByRole('button', { name: 'Map erstellen', exact: true }).click();
    await expect(page.locator('#custom-map-name')).toHaveText('Döner-Map');
    await expect(page.locator('#custom-map-entries')).toContainText('Deine Map ist bereit');
    await page.locator('#map-add-entry').click();
    await page.getByRole('searchbox', { name: 'Lokal suchen' }).fill('Test Döner');
    await expect(page.locator('#map-entry-dialog select')).toHaveValue(venue.id);
    await page.getByRole('textbox', { name: 'Produkt / Portion' }).fill('Döner im Taschenbrot');
    await page.getByRole('spinbutton', { name: 'Preis pro Portion in CHF' }).fill('12.50');
    await page.locator('#map-entry-dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('#custom-map-entries')).toContainText('CHF 12.50');
    await expect(page.locator('#custom-map-summary')).toHaveText('1 Lokal · Schnitt CHF 12.50');
    await page.locator('#custom-map-entries .venue').click();
    await page.getByRole('button', { name: 'Preis ändern', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Preis pro Portion in CHF' }).fill('13');
    await page.locator('#map-entry-dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('#custom-map-entries')).toContainText('CHF 13.00');
    const link = page.url();
    await page.locator('#map-share').click();
    await expect(page.locator('#custom-map-share input')).toHaveValue(link);
    await page.reload();
    await expect(page.locator('#custom-map-name')).toHaveText('Döner-Map');
    await expect(page.locator('#custom-map-entries')).toContainText('CHF 13.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/wobillig-custom-map-${width}.png` });
    await page.locator('#map-back').click();
    await expect(page.locator('#drink-coffee')).toBeVisible();
    await expect(page).not.toHaveURL(/map=/);
    await expect(page.locator('#my-maps')).toBeHidden();
    await page.locator('#categories-toggle').click();
    await page.locator('#my-maps').click();
    await page.locator('#saved-maps').getByRole('button', { name: 'Döner-Map', exact: true }).click();
    await expect(page.locator('#custom-map-name')).toHaveText('Döner-Map');
    // A new visitor can open the link without the creator's local saved list.
    const other = await context.newPage();
    await other.addInitScript(() => localStorage.clear());
    await other.goto(link);
    await expect(other.locator('#custom-map-name')).toHaveText('Döner-Map');
    await expect(other.locator('#custom-map-entries')).toContainText('CHF 13.00');
  });
}

test('creation errors preserve input, retry uses the same ID, and Escape returns focus', async ({ page }) => {
  const ids: string[] = [];
  await page.route('**/api/prices?*', route => {
    if (route.request().method() === 'POST') {
      ids.push(route.request().postDataJSON().mapId);
      return route.fulfill({ status: 503, json: { error: 'Map konnte nicht geladen oder gespeichert werden. Bitte erneut versuchen.' } });
    }
    return route.fulfill({ json: { entries: [] } });
  });
  await page.goto('/en');
  await page.getByRole('button', { name: 'Create map', exact: true }).click();
  await page.getByRole('textbox', { name: 'Map name' }).fill('Ice cream');
  const submit = page.locator('#create-map-dialog').getByRole('button', { name: 'Create map', exact: true });
  await submit.click();
  await expect(page.locator('#create-map-dialog [role=alert]')).toContainText('The map could not be loaded or saved');
  await expect(page.getByRole('textbox', { name: 'Map name' })).toHaveValue('Ice cream');
  await submit.click();
  await expect(submit).toBeEnabled();
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#create-map')).toBeFocused();
});

test('a missing venue can be added from an own map without losing the price form', async ({ page }) => {
  const saved: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Döner-Map', createdAt: new Date().toISOString(), entries: [] };
  let newVenue = venue;
  await page.route('**/api/prices?*', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.action === 'addVenue') {
        newVenue = { ...venue, ...body.venue, id: 'community/new-doner' };
        return route.fulfill({ json: { venue: newVenue, created: true } });
      }
      saved.entries = [{ venue: newVenue, product: body.product, priceChf: body.priceChf, revision: 1, updatedAt: new Date().toISOString() }];
      return route.fulfill({ json: { map: saved } });
    }
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map: saved } : { entries: [] } });
  });
  await page.goto(`/?map=${saved.id}`);
  await page.locator('#map-add-entry').click();
  await page.getByRole('button', { name: 'Lokal fehlt? Neu hinzufügen' }).click();
  const dialog = page.locator('#custom-venue-dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Neuer Döner');
  await dialog.getByLabel('Art des Lokals').selectOption('fast_food');
  await dialog.getByLabel('Strasse und Hausnummer').fill('Langstrasse 2');
  await dialog.getByLabel('Postleitzahl').fill('8004');
  await dialog.getByRole('button', { name: 'Kartenmitte übernehmen' }).click();
  await dialog.getByRole('button', { name: 'Lokal speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#map-entry-dialog select')).toHaveValue('community/new-doner');
  await page.getByRole('textbox', { name: 'Produkt / Portion' }).fill('Dürüm');
  await page.getByRole('spinbutton', { name: 'Preis pro Portion in CHF' }).fill('14');
  await page.locator('#map-entry-dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('#custom-map-entries')).toContainText('Neuer Döner');
  await expect(page.locator('#custom-map-entries')).toContainText('CHF 14.00');
});
