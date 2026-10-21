import { test, expect, type Page } from '@playwright/test';
import type { CustomMap } from '../src/custom-map-data';

async function stubTiles(page: Page) {
  // Test venue selection independently of Leaflet's animated zoom timing.
  await page.addInitScript(() => { (window as typeof window & { L_DISABLE_3D: boolean }).L_DISABLE_3D = true; });
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
}

const id = 'd268dbea-93cf-45de-9d17-2b5c74090236';
const venue = { id: 'node/click-test', name: 'Klick-Café', address: 'Testgasse 1', postcode: '8004', lat: 47.378, lon: 8.535,
  type: 'cafe', offers: [], website: null, openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'unavailable' };

for (const touch of [false, true]) {
  test(`map ${touch ? 'tap' : 'click'} selects a venue and saves an entry`, async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: touch, viewport: { width: touch ? 390 : 1280, height: 844 } });
    const page = await context.newPage();
    await stubTiles(page);
    const saved: CustomMap = { id, name: 'Klick-Map', createdAt: '2026-10-21', entries: [] };
    const posts: any[] = [];
    await page.route('**/api/tip?*', route => route.fulfill({ json: { enabled: false } }));
    await page.route('**/data/*.json', route => route.fulfill({ json: { bars: route.request().url().endsWith('locations.json') ? [venue] : [] } }));
    await page.route('**/api/prices?*', route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); posts.push(body);
        saved.entries = [{ venue, product: body.product, priceChf: body.priceChf, revision: 1, updatedAt: '2026-10-21' }];
        return route.fulfill({ json: { map: saved } });
      }
      return route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map: saved } : { entries: [] } });
    });
    await page.goto(`http://127.0.0.1:${process.env.WOBILLIG_TEST_PORT || 5179}/?map=${id}`);
    const canvas = page.locator('#custom-map-canvas');
    await expect(canvas).toBeVisible();
    // Leaflet zoom animation must settle between presses.
    for (let i = 0; i < 4; i++) {
      await canvas.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect(canvas.locator(`img[src*="/${14 + i}/"]`).first()).toBeAttached();
      await expect(canvas.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/);
    }
    if (touch) await canvas.tap(); else await canvas.click();
    const entry = page.locator('#map-entry-dialog');
    await expect(entry).toBeVisible();
    await expect(entry.locator('[name=venue]')).toHaveValue(venue.id);
    await expect(page.locator('#map-new-venue')).toBeHidden();
    await entry.getByRole('textbox', { name: 'Produkt / Menge' }).fill('Steak');
    await entry.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('25');
    await page.screenshot({ path: `/tmp/wobillig-custom-map-click-${touch ? 'mobile' : 'desktop'}.png` });
    await entry.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(entry).toBeHidden();
    expect(posts[0]).toMatchObject({ action: 'saveMapEntry', mapId: id, barId: venue.id, product: 'Steak', priceChf: 25 });
    await expect(page.locator('.custom-map-marker')).toHaveText('25.00');
    // An existing price marker still opens details, not a second entry dialog.
    await page.locator('.custom-map-marker').click();
    await expect(page.locator('#custom-map-detail')).toContainText('Steak');
    await expect(entry).toBeHidden();
    await context.close();
  });
}

test('ambiguous map click offers nearby venues; blank space retains a position for a new place', async ({ page }) => {
  await stubTiles(page);
  const second = { ...venue, id: 'node/neighbour', name: 'Nachbar-Café', lon: 8.5351 };
  await page.route('**/api/tip?*', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/data/*.json', route => route.fulfill({ json: { bars: route.request().url().endsWith('locations.json') ? [venue, second] : [] } }));
  await page.route('**/api/prices?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('map')
    ? { map: { id, name: 'Klick-Map', createdAt: '2026-10-21', entries: [] } } : { entries: [] } }));
  await page.goto(`/?map=${id}`);
  const canvas = page.locator('#custom-map-canvas');
  await expect(canvas).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await canvas.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(canvas.locator(`img[src*="/${14 + i}/"]`).first()).toBeAttached();
    await expect(canvas.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/);
  }
  const size = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: size.width / 2 + 60, y: size.height / 2 - 25 } });
  await expect(canvas.locator('.location-choices')).toContainText('Für welches Lokal?');
  await canvas.getByRole('button', { name: 'Nachbar-Café · Testgasse 1' }).click();
  await expect(page.locator('#map-entry-dialog [name=venue]')).toHaveValue(second.id);
  await page.locator('#map-entry-dialog').getByRole('button', { name: 'Schliessen' }).click();
  await expect(page.locator('#map-entry-dialog')).toBeHidden();
  await expect(canvas.locator('.leaflet-popup')).toHaveCount(0);
  await expect(canvas.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-pan-anim/);
  await canvas.click({ position: { x: 300, y: 180 } });
  await expect(page.locator('#map-entry-dialog')).toBeVisible();
  await expect(page.locator('#map-entry-dialog [name=venue]')).toHaveValue('');
  await page.locator('#map-new-venue').click();
  await expect(page.locator('#custom-venue-dialog')).toBeVisible();
  await expect(page.locator('#custom-venue-position')).toContainText('Position gewählt');
  await expect(page.locator('#custom-venue-map .new-venue-marker')).toBeVisible();
});

for (const touch of [false, true]) {
  test(`OSM pharmacy appears on zoom and can be saved on ${touch ? 'mobile' : 'desktop'}`, async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: touch, viewport: { width: touch ? 390 : 1280, height: 844 } });
    const page = await context.newPage();
    await stubTiles(page);
    // The pharmacy is absent from the local catalogue, as in production.
    const pharmacy = { ...venue, id: 'node/12345', name: 'Apotheke am Limmatplatz', type: 'pharmacy' };
    const saved: CustomMap = { id, name: 'Apotheken', createdAt: '2026-10-21', entries: [] };
    let viewportRequests = 0;
    const posts: any[] = [];
    await page.route('**/api/tip?*', route => route.fulfill({ json: { enabled: false } }));
    await page.route('**/data/*.json', route => route.fulfill({ json: { bars: [] } }));
    await page.route('**/api/prices?*', route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.has('mapPlaceBounds')) {
        viewportRequests++;
        if (viewportRequests === 1) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        return route.fulfill({ json: { places: [{ venue: pharmacy, token: 'signed-pharmacy' }] } });
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); posts.push(body);
        saved.entries = [{ venue: pharmacy, product: body.product, priceChf: body.priceChf, revision: 1, updatedAt: '2026-10-21' }];
        return route.fulfill({ json: { map: saved } });
      }
      return route.fulfill({ json: params.has('map') ? { map: saved } : { entries: [] } });
    });
    await page.goto(`/?map=${id}`);
    const canvas = page.locator('#custom-map-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('.custom-map-place-marker')).toHaveCount(0);
    expect(viewportRequests).toBe(0);
    for (let i = 0; i < 4; i++) {
      await canvas.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect(canvas.locator(`img[src*="/${14 + i}/"]`).first()).toBeAttached();
      await expect(canvas.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/);
    }
    const marker = canvas.getByRole('button', { name: pharmacy.name, exact: true });
    const status = page.locator('.custom-map-place-status');
    await expect(status).toContainText('OpenStreetMap-Orte konnten nicht geladen werden');
    await status.getByRole('button', { name: 'Erneut versuchen' }).click();
    await expect(marker).toBeVisible();
    await expect(status).toBeHidden();
    await expect(marker).toContainText(pharmacy.name);
    await canvas.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(canvas.locator('.custom-map-place-marker')).toHaveCount(0);
    await expect(canvas.locator('img[src*="/16/"]').first()).toBeAttached();
    await expect(canvas.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/);
    await canvas.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(marker).toBeVisible();
    expect(viewportRequests).toBe(2);
    await page.screenshot({ path: `/tmp/wobillig-osm-places-${touch ? 'mobile' : 'desktop'}.png` });
    if (touch) await marker.tap(); else await marker.click();
    const entry = page.locator('#map-entry-dialog');
    await expect(entry.locator('[name=venue]')).toHaveValue(pharmacy.id);
    await expect(page.locator('#map-new-venue')).toBeHidden();
    await entry.getByRole('combobox').fill('Anderer Ort');
    await expect(page.locator('#map-new-venue')).toBeVisible();
    await entry.getByRole('button', { name: 'Schliessen' }).click();
    await marker.click();
    await entry.getByRole('textbox', { name: 'Produkt / Menge' }).fill('Tampons, 16 Stück');
    await entry.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('4.90');
    await entry.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(entry).toBeHidden();
    expect(posts[0]).toMatchObject({ barId: pharmacy.id, placeToken: 'signed-pharmacy', priceChf: 4.9 });
    await expect(canvas.locator('.custom-map-marker')).toHaveText('4.90');
    await expect(canvas.locator('.custom-map-place-marker')).toHaveCount(0);
    await context.close();
  });
}
