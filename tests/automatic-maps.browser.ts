import { test, expect } from '@playwright/test';
import type { CustomMap } from '../src/custom-map-data';
import { mapReviewCards } from '../server/map-review';
import { reviewHtml } from '../server/price-review.mjs';

for (const width of [320, 1280]) {
  test(`request, reopen and see review feedback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let saved: CustomMap | undefined;
    await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
    await page.route('**/api/prices?*', route => {
      const req = route.request(), params = new URL(req.url()).searchParams;
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        expect(body.action).toBe('requestAutomaticMap');
        saved = { id: body.mapId, name: body.name, createdAt: new Date().toISOString(), entries: [],
          automatic: { sourceUrl: body.sourceUrl, description: body.description, status: 'requested', revision: 1 } };
        return route.fulfill({ json: { map: saved } });
      }
      return route.fulfill({ json: params.has('mapStatuses') ? { maps: [{ id: saved?.id, name: saved?.name, automaticStatus: saved?.automatic?.status }] }
        : params.has('map') ? { map: saved } : { entries: [] } });
    });
    await page.goto('/');
    await page.locator('#create-map').click();
    const form = page.locator('#create-map-dialog');
    await form.getByLabel('Art der Map').selectOption('automatic');
    await form.getByLabel('Name der Map').fill('Coop Aktionen Zürich');
    await form.getByLabel('Link zur Angebotsseite').fill('https://www.coop.ch/de/aktionen/alle-aktionen/c/m_1111');
    await form.getByLabel('Welche Angebote möchtest du sehen?').fill('Kaffeeaktionen');
    await expect(form).toContainText('Die Anfrage startet noch keine automatische Map.');
    await page.screenshot({ path: `/tmp/wobillig-automatic-map-form-${width}.png` });
    await form.getByRole('button', { name: 'Anfrage einreichen' }).click();
    await expect(page.locator('#custom-map-summary')).toHaveText('Anfrage eingereicht');
    await expect(page.locator('#automatic-map-details')).toContainText('Kaffeeaktionen');
    await expect(page.locator('#map-add-entry')).toBeHidden();
    await expect(page.locator('#map-publish-control')).toBeHidden();
    await expect(page.locator('.custom-map-content')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    saved!.automatic = { ...saved!.automatic!, status: 'blocked', revision: 2, note: 'Coop blockiert derzeit automatische Abrufe.' };
    await page.locator('#map-back').click();
    await page.locator('#categories-toggle').click();
    await page.locator('#my-maps').click();
    await expect(form.locator('#saved-maps')).toContainText('Quelle noch nicht verfügbar');
    await form.locator('#saved-maps button').click();
    await expect(page.locator('#automatic-map-details')).toContainText('Coop blockiert derzeit automatische Abrufe.');
    await page.reload();
    await expect(page.locator('#custom-map-summary')).toHaveText('Quelle noch nicht verfügbar');
    await page.screenshot({ path: `/tmp/wobillig-automatic-map-status-${width}.png` });
  });
}

test('the English request form translates choices and explains review', async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.goto('/en');
  await page.locator('#create-map').click();
  await page.getByLabel('Map type').selectOption('automatic');
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeVisible();
  await expect(page.locator('#create-map-dialog')).toContainText('Submitting a request does not start an automatic map.');
});

test('automatic requests appear on the combined admin page and submit their review revision', async ({ page }) => {
  const map: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Coop Aktionen Zürich',
    createdAt: '2026-10-20T12:00:00Z', entries: [], automatic: { sourceUrl: 'https://www.coop.ch/de/aktionen.html',
      description: 'Kaffeeaktionen', status: 'requested', revision: 1 } };
  const maps = [{ city: 'zurich' as const, map }];
  const html = reviewHtml([], 'production', undefined, true, maps, mapReviewCards(maps));
  await page.route('**/review-preview', route => route.fulfill({ contentType: 'text/html', body: html }));
  let body = '';
  await page.route('**/api/map-review', route => { body = route.request().postData()!; return route.fulfill({ body: 'Gespeichert' }); });
  await page.goto('/review-preview');
  await expect(page.getByRole('heading', { name: 'Automatische Maps', exact: true })).toBeVisible();
  await expect(page.locator('#map-overview')).toContainText('Anfrage eingereicht');
  const card = page.locator('#automatic-map-review article');
  await card.getByRole('combobox', { name: 'Status', exact: true }).selectOption('blocked');
  await card.getByLabel('Rückmeldung').fill('Coop blockiert den Abruf.');
  await page.screenshot({ path: '/tmp/wobillig-automatic-map-admin.png', fullPage: true });
  await card.getByRole('button', { name: 'Status speichern' }).click();
  await expect.poll(() => new URLSearchParams(body).get('decision')).toBe('blocked');
  expect(new URLSearchParams(body).get('revision')).toBe('1');
  expect(new URLSearchParams(body).get('kind')).toBe('automatic');
});
