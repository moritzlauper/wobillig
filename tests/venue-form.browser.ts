import { expect, test } from '@playwright/test';
import type { Bar } from '../src/data';

test('mobile visitors can create a venue, reload it and add a price', async ({ page }) => {
  const venues: Bar[] = [], entries: unknown[] = [];
  await page.route('**/api/prices?city=bern', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { venues, entries } });
    const body = route.request().postDataJSON();
    if (body.action === 'addVenue') {
      const venue = { ...body.venue, id: 'community/test-cafe', offers: [], openingHours: null, scrapeStatus: 'community', checkedAt: null };
      venues.push(venue); return route.fulfill({ json: { venue, created: true } });
    }
    const entry = { id: '11111111-1111-1111-1111-111111111111', barId: venues[0].id, drink: 'coffee', revision: 1,
      targetKey: '', updatedAt: new Date().toISOString(), offer: { ...body, confidence: 'community' }, venue: venues[0] };
    entries.push(entry); return route.fulfill({ json: { entry } });
  });
  await page.route('https://api3.geo.admin.ch/**', route => route.fulfill({ json: { results: [
    { attrs: { label: 'Testgasse 12 <b>3011 Bern</b>', lat: 46.948, lon: 7.447, origin: 'address' } },
  ] } }));
  await page.goto('/bern');
  await expect(page.locator('.price-marker').first()).toBeVisible();
  await page.getByRole('button', { name: 'Lokal hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lokal hinzufügen', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill('Neues Testcafé');
  await dialog.getByLabel('Strasse und Hausnummer').fill('Testgasse 12');
  await dialog.getByLabel('Postleitzahl').fill('3011');
  await dialog.getByRole('button', { name: 'Lokal speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Kartenposition');
  expect(venues).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Adresse auf Karte suchen' }).click();
  await dialog.getByRole('button', { name: 'Testgasse 12 3011 Bern' }).click();
  await expect(dialog.locator('#venue-position')).toContainText('Position gewählt');
  await dialog.locator('#venue-map').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/venue-form-mobile.png' });
  await dialog.getByRole('button', { name: 'Lokal speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#detail')).toContainText('Neues Testcafé');
  expect(venues).toHaveLength(1);
  await page.reload();
  await expect(page.locator('#detail')).toContainText('Neues Testcafé');
  await page.getByRole('button', { name: 'Preis hinzufügen', exact: true }).click();
  await page.getByText('Preis von Hand eintragen', { exact: true }).click();
  await page.getByLabel('Preis in CHF', { exact: true }).fill('5.20');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('#detail')).toContainText('CHF 5.20');
  expect(entries).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Lokal hinzufügen', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Neues Testcafé');
  await dialog.getByRole('button', { name: 'Neues Testcafé · Testgasse 12' }).click();
  await expect(dialog).not.toBeVisible();
  expect(venues).toHaveLength(1);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('manual map placement works when address search fails; save failure keeps the form', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/prices?*', route => route.fulfill(route.request().method() === 'GET'
    ? { json: { entries: [] } } : { status: 503, json: { error: 'Speichern gerade nicht möglich.' } }));
  await page.route('https://api3.geo.admin.ch/**', route => route.abort());
  await page.goto('/bern');
  await expect(page.locator('.price-marker').first()).toBeVisible();
  await page.getByRole('button', { name: 'Lokal hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lokal hinzufügen', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Anderes Testcafé');
  await dialog.getByLabel('Strasse und Hausnummer').fill('Testgasse 12');
  await dialog.getByLabel('Postleitzahl').fill('3011');
  await dialog.getByRole('button', { name: 'Adresse auf Karte suchen' }).click();
  await expect(dialog.locator('#venue-search-status')).toContainText('nicht verfügbar');
  await dialog.getByRole('button', { name: 'Kartenmitte übernehmen' }).click();
  await dialog.getByRole('button', { name: 'Lokal speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Speichern gerade nicht möglich.');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Anderes Testcafé');
  await expect(dialog.getByRole('button', { name: 'Lokal speichern', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/venue-form-desktop.png' });
  await dialog.getByLabel('Strasse und Hausnummer').fill('Testgasse 14');
  await expect(dialog.locator('#venue-position')).toContainText('erneut wählen');
});
