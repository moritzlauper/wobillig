import { test, expect } from '@playwright/test';
import type { CustomMap } from '../src/custom-map-data';

const venue = { id: 'node/test-doner', name: 'Test Döner', address: 'Langstrasse 1', postcode: '8004', lat: 47.378, lon: 8.53,
  type: 'fast_food', offers: [], website: null, openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'unavailable' };
test.beforeEach(async ({ context }) => {
  await context.route('**/api/tip?*', route => route.fulfill({ json: { enabled: false } }));
  await context.route('**/api/prices?*mapPlaces=*', route => route.fulfill({ json: { places: [] } }));
  await context.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await context.route('**/data/locations.json', route => route.fulfill({ json: { bars: [venue] } }));
});

for (const width of [320, 1280]) {
  test(`saved maps open directly and are separated from other public maps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const own = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Meine Glace-Map' };
    const other = { id: 'd268dbea-93cf-45de-9d17-2b5c74090237', name: 'Öffentliche Matcha-Map' };
    await page.addInitScript(map => localStorage.setItem('wobillig:maps:zurich', JSON.stringify([map])), own);
    await page.route('**/api/prices?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('map')
      ? { map: { ...own, createdAt: new Date().toISOString(), entries: [] } }
      : { entries: [], publicMaps: [own, other].map(map => ({ ...map, venueCount: 1 })) } }));
    await page.goto('/');
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    await page.locator('#categories-toggle').click();
    const menu = page.locator('#additional-categories');
    await expect(menu.getByRole('group', { name: 'Meine Maps', exact: true }).getByRole('button')).toHaveText(`${own.name} · Community-Map`);
    const publicGroup = menu.getByRole('group', { name: 'Community-Maps', exact: true });
    await expect(publicGroup.getByRole('button')).toHaveText(`${other.name} · 1 Lokale`);
    await expect(publicGroup).toHaveCSS('border-top-width', '1px');
    await expect(menu.locator(`[data-custom-map="${own.id}"]`)).toHaveCount(1);
    await expect(menu.getByRole('button', { name: 'Meine Maps', exact: true })).toHaveCount(0);
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath('community-map-menu.png') });
    await menu.getByRole('button', { name: `${own.name} · Community-Map`, exact: true }).click();
    await expect(page.locator('#custom-map-name')).toHaveText(own.name);
    await expect(page.locator('#create-map-dialog')).toBeHidden();
  });
  test(`venue autocomplete searches beyond the first 80 places at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const lateVenue = { ...venue, id: 'node/zuribiss', name: 'Züribiss', address: 'Zähringerstrasse 999', postcode: '8001' };
    const catalogue = [...Array.from({ length: 120 }, (_, i) => ({ ...venue, id: `node/a${i}`, name: `A Lokal ${i}` })), lateVenue];
    await page.route('**/data/locations.json', route => route.fulfill({ json: { bars: catalogue } }));
    let releaseLookup!: () => void, lookupStarted!: () => void;
    const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookupRequest = new Promise<void>(resolve => { lookupStarted = resolve; });
    await page.route('**/api/prices?*mapPlaces=*', async route => {
      if (new URL(route.request().url()).searchParams.get('mapPlaces') === '999 Zaehringerstr.') {
        lookupStarted(); await lookupGate;
      }
      return route.fulfill({ json: { places: [] } });
    });
    const saved: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Döner-Map', createdAt: new Date().toISOString(), entries: [] };
    const submissions: any[] = [];
    await page.route('**/api/prices?*', route => {
      if (new URL(route.request().url()).searchParams.has('mapPlaces')) return route.fallback();
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); submissions.push(body);
        saved.entries = [{ venue: lateVenue, product: body.product, priceChf: body.priceChf, revision: 1, updatedAt: new Date().toISOString() }];
        return route.fulfill({ json: { map: saved } });
      }
      return route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map: saved } : { entries: [] } });
    });
    await page.goto(`/?map=${saved.id}`);
    await page.locator('#map-add-entry').click();
    const dialog = page.locator('#map-entry-dialog');
    const search = dialog.getByRole('combobox', { name: 'Ort oder Geschäft suchen' });
    await expect(dialog.locator('select')).toHaveCount(0);
    await search.fill('Zueribiss');
    await expect(dialog.getByRole('option', { name: /Züribiss/ })).toBeVisible();
    await search.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(search).toHaveAttribute('aria-expanded', 'false');
    await search.fill('999 Zaehringerstr.');
    await expect(dialog.getByRole('option', { name: /Züribiss/ })).toBeVisible();
    await page.screenshot({ path: `/tmp/wobillig-map-venue-search-${width}.png` });
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', 'map-venue-option-0');
    await lookupRequest;
    releaseLookup();
    await expect(page.locator('#map-venue-search-help')).toHaveText('Bitte ein Lokal aus den Vorschlägen auswählen.');
    await expect(search).toHaveAttribute('aria-activedescendant', 'map-venue-option-0');
    await search.press('Enter');
    await expect(dialog.locator('[name=venue]')).toHaveValue(lateVenue.id);
    await dialog.getByRole('textbox', { name: 'Produkt / Menge' }).fill('Döner');
    await dialog.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('12');
    // Typing after selecting must not submit the previously chosen venue.
    await search.fill('Nicht vorhandenes Lokal XYZ');
    await expect(dialog.locator('[name=venue]')).toHaveValue('');
    await expect(dialog.locator('#map-venue-search-help')).toContainText('Kein Lokal gefunden');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    expect(submissions).toHaveLength(0);
    await search.fill('Züribiss 8001');
    await dialog.getByRole('option', { name: /Züribiss/ }).click();
    await dialog.getByRole('textbox', { name: 'Produkt / Menge' }).fill('Döner');
    await dialog.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('12');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('#custom-map-entries')).toContainText('Züribiss');
    expect(submissions[0].barId).toBe(lateVenue.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
  test(`public maps stay collapsed under More at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const saved: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Glace-Map', publishedAt: '2026-10-20T12:00:00Z', publication: { status: 'approved', requestedAt: '2026-10-20T12:00:00Z', fingerprint: 'test' }, createdAt: new Date().toISOString(),
      entries: Array.from({ length: 5 }, (_, i) => ({ venue: { ...venue, id: `node/${i}` }, product: 'Glace', priceChf: 5, revision: 1, updatedAt: new Date().toISOString() })) };
    await page.route('**/api/prices?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('map')
      ? { map: saved } : { entries: [], publicMaps: [{ id: saved.id, name: saved.name, venueCount: 5 },
        { id: 'd268dbea-93cf-45de-9d17-2b5c74090237', name: 'Draft map', venueCount: 0 }] } }));
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
    await expect(page.locator('#custom-map-visibility')).toHaveText('Community-Map · Von der Community erstellt und öffentlich unter «Weitere» sichtbar.');
    await page.screenshot({ path: test.info().outputPath('community-map-view.png') });
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
    await expect(page.locator('#custom-map-created')).toContainText('Nur per Link erreichbar.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#custom-map-created').getByRole('button', { name: 'Link kopieren' }).click();
    await expect(page.locator('#custom-map-created [role=status]')).toHaveText('Link kopiert.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    await page.locator('#custom-map-created').getByRole('button', { name: 'Schliessen' }).click();
    await expect(page.locator('#custom-map-created')).toBeHidden();
    await page.locator('#map-add-entry').click();
    await page.getByRole('combobox', { name: 'Ort oder Geschäft suchen' }).fill('Test Döner');
    await page.getByRole('option', { name: /Test Döner/ }).click();
    await expect(page.locator('#map-entry-dialog [name=venue]')).toHaveValue(venue.id);
    await page.getByRole('textbox', { name: 'Produkt / Menge' }).fill('Döner im Taschenbrot');
    await page.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('12.50');
    await page.locator('#map-entry-dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('#custom-map-entries')).toContainText('CHF 12.50');
    await expect(page.locator('#custom-map-summary')).toHaveText('1 Lokal · Schnitt CHF 12.50');
    if (width <= 760) await page.locator('#custom-view-list').click();
    await page.locator('#custom-map-entries .venue').click();
    await expect(page.locator('#custom-map-detail')).toBeVisible();
    await expect(page.getByRole('link', { name: 'In Google Maps öffnen' })).toHaveAttribute('href', /google\.com\/maps\/search/);
    await page.locator('#custom-map-detail').getByRole('button', { name: 'Ändern', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('13');
    await page.locator('#map-entry-dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('#custom-map-entries')).toContainText('CHF 13.00');
    const link = page.url();
    await page.locator('#map-share').click();
    await expect(page.locator('#custom-map-share input')).toHaveValue(link);
    await page.reload();
    await expect(page.locator('#custom-map-name')).toHaveText('Döner-Map');
    await expect(page.locator('#custom-map-created')).toBeHidden();
    await expect(page.locator('#custom-map-entries')).toContainText('CHF 13.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/wobillig-custom-map-${width}.png` });
    await page.locator('#map-back').click();
    await expect(page.locator('#drink-coffee')).toBeVisible();
    await expect(page).not.toHaveURL(/map=/);
    await expect(page.locator('#additional-categories')).toBeHidden();
    await page.locator('#categories-toggle').click();
    await page.locator('#additional-categories').getByRole('button', { name: 'Döner-Map', exact: true }).click();
    await expect(page.locator('#create-map-dialog')).toBeHidden();
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
      if (new URL(route.request().url()).searchParams.has('mapPlaces')) return route.fallback();
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
    if (new URL(route.request().url()).searchParams.has('mapPlaces')) return route.fallback();
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
  await expect(page.locator('#map-entry-dialog [name=venue]')).toHaveValue('community/new-doner');
  await page.getByRole('textbox', { name: 'Produkt / Menge' }).fill('Dürüm');
  await page.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('14');
  await page.locator('#map-entry-dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('#custom-map-entries')).toContainText('Neuer Döner');
  await expect(page.locator('#custom-map-entries')).toContainText('CHF 14.00');
});

test('adds a shop from OpenStreetMap with its signed selection and a non-food product', async ({ page }) => {
  const shop = { ...venue, id: 'node/osm-shop', name: 'Migros Testfiliale', type: 'supermarket', address: 'Teststrasse 15' };
  const saved: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Tampon-Map', createdAt: new Date().toISOString(), entries: [] };
  let submitted: any;
  await page.route('**/api/prices?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('mapPlaces')) return route.fulfill({ json: { places: [{ venue: shop, token: 'signed-shop' }] } });
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      saved.entries = [{ venue: shop, product: submitted.product, priceChf: submitted.priceChf, revision: 1, updatedAt: new Date().toISOString() }];
      return route.fulfill({ json: { map: saved } });
    }
    return route.fulfill({ json: url.searchParams.has('map') ? { map: saved } : { entries: [] } });
  });
  await page.goto(`/?map=${saved.id}`);
  await expect(page.locator('#map-publish')).toBeDisabled();
  await expect(page.locator('#map-share')).toBeEnabled();
  await page.locator('#map-add-entry').click();
  await page.getByRole('combobox', { name: 'Ort oder Geschäft suchen' }).fill('Migros');
  await page.getByRole('option', { name: /Migros Testfiliale/ }).click();
  await page.getByRole('textbox', { name: 'Produkt / Menge' }).fill('Tampons, Packung mit 16 Stück');
  await page.getByRole('spinbutton', { name: 'Preis in CHF' }).fill('3.90');
  await page.locator('#map-entry-dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('#custom-map-entries')).toContainText('Tampons, Packung mit 16 Stück');
  await expect(page.locator('#map-publish')).toBeEnabled();
  expect(submitted).toMatchObject({ barId: shop.id, placeToken: 'signed-shop', priceChf: 3.9 });
});

test('one place stays link-only until explicit publication and reviewer approval', async ({ page }) => {
  const saved: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Tampon-Map', createdAt: new Date().toISOString(),
    entries: Array.from({ length: 1 }, (_, i) => ({ venue: { ...venue, id: `node/${i}` }, product: 'Tampons, 16 Stück', priceChf: 4, revision: 1, updatedAt: new Date().toISOString() })) };
  await page.route('**/api/prices?*', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().action).toBe('requestMapPublication');
      saved.publication = { status: 'pending', requestedAt: new Date().toISOString(), fingerprint: 'test' };
      return route.fulfill({ json: { map: saved } });
    }
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map: saved } : { entries: [],
      publicMaps: saved.publication?.status === 'approved' ? [{ id: saved.id, name: saved.name, venueCount: 1 }] : [] } });
  });
  await page.goto(`/en?map=${saved.id}`);
  await expect(page.getByRole('button', { name: 'Share map', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Publish map for everybody' })).toBeEnabled();
  await expect(page.locator('#custom-map-visibility')).toBeHidden();
  await page.getByRole('button', { name: 'Publish map for everybody' }).click();
  await expect(page.locator('#custom-map-visibility')).toContainText('Submitted for review');
  await page.locator('#map-back').click();
  await page.locator('#categories-toggle').click();
  await expect(page.getByRole('group', { name: 'My maps', exact: true }).locator('[data-custom-map]')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Community maps', exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('wobillig:maps:zurich'));
  await page.reload();
  await expect(page.locator('[data-custom-map]')).toHaveCount(0);
  saved.publication!.status = 'approved'; saved.publishedAt = new Date().toISOString();
  await page.reload();
  await page.locator('#categories-toggle').click();
  await expect(page.locator(`[data-custom-map="${saved.id}"]`)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Community maps', exact: true })).toBeVisible();
  await page.locator(`[data-custom-map="${saved.id}"]`).click();
  await expect(page.locator('#custom-map-visibility')).toHaveText('Community map · Created by the community and publicly listed under “More”.');
});

for (const locale of ['de', 'en']) {
  test(`compact mobile map and list views with venue details in ${locale}`, async ({ page }) => {
    const saved: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Falafel', createdAt: '2026-10-20',
      entries: [{ venue, product: 'Falafel', priceChf: 4.59, revision: 1, updatedAt: '2026-10-20' }] };
    await page.route('**/api/prices?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map: saved } : { entries: [] } }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${locale === 'en' ? '/en' : '/'}?map=${saved.id}`);
    await expect(page.locator('#map-options-toggle')).toHaveCount(0);
    await expect(page.locator('#map-add-entry')).toBeVisible();
    await expect(page.locator('#custom-map-visibility')).toBeHidden();
    expect((await page.locator('.custom-map-toolbar').boundingBox())!.height).toBeLessThan(110);
    await expect(page.locator('#custom-view-map')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#custom-map-entries')).toBeHidden();
    expect((await page.locator('#custom-map-canvas').boundingBox())!.height).toBeGreaterThan(650);
    const buttons = await Promise.all(['map-share', 'map-publish', 'map-add-entry'].map(id => page.locator(`#${id}`).boundingBox()));
    for (const button of buttons) {
      expect(button!.y).toBe(buttons[0]!.y);
      expect(button!.height).toBeLessThanOrEqual(36);
    }
    await page.screenshot({ path: `/tmp/wobillig-custom-options-${locale}.png` });
    await page.locator('.custom-map-marker').click();
    const detail = page.locator('#custom-map-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Langstrasse 1');
    await expect(detail).toContainText('Falafel');
    const mapsLink = detail.getByRole('link', { name: locale === 'en' ? 'Open in Google Maps' : 'In Google Maps öffnen' });
    const mapsUrl = new URL((await mapsLink.getAttribute('href'))!);
    expect(mapsUrl.searchParams.get('query')).toBe('Test Döner, Langstrasse 1, 8004, Zürich, Schweiz');
    await expect(mapsLink).toHaveAttribute('target', '_blank');
    await expect(page.locator('#map-entry-dialog')).toBeHidden();
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/wobillig-custom-detail-${locale}.png` });
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await page.locator('#custom-view-list').click();
    await expect(page.locator('#custom-view-list')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#custom-view-map')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#custom-map-canvas')).toBeHidden();
    await expect(page.locator('#custom-map-entries')).toBeVisible();
    expect((await page.locator('.custom-map-heading').boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `/tmp/wobillig-custom-list-${locale}.png` });
    await page.locator('#custom-map-entries .venue').click();
    await expect(detail).toBeVisible();
    await expect(page.locator('#custom-map-canvas')).toBeVisible();
    await expect(page.locator('#custom-map-entries')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#custom-map-canvas')).toBeHidden();
    await expect(page.locator('#custom-map-entries .venue')).toBeFocused();
    await page.locator('#custom-view-map').click();
    await expect(page.locator('#custom-map-entries')).toBeHidden();
    await expect(page.locator('#custom-map-canvas')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `/tmp/wobillig-custom-collapsed-${locale}.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('#custom-map-view-switch')).toBeHidden();
    await expect(page.locator('#map-share')).toBeVisible();
    await expect(page.locator('#map-add-entry')).toBeVisible();
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(page.locator('#map-add-entry')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
