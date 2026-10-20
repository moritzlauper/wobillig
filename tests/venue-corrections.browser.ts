import { expect, test, type Page } from '@playwright/test';
import type { Bar } from '../src/data';
import type { VenueCorrection } from '../src/venue-corrections';
import { captureAnalytics } from './analytics-browser-helper';

const venue: Bar = { id: 'node/123', name: 'Korrektur Café', address: '', postcode: '', website: 'https://wrong.example/',
  lat: 46.948, lon: 7.447, type: 'cafe', outdoor: false, openingHours: null, checkedAt: null, scrapeStatus: 'ok',
  offers: [{ name: 'Espresso', coffeeType: 'espresso', priceChf: 4, volumeMl: null, alcoholFree: true,
    confidence: 'automatic', sourceUrl: 'https://menu.example/', evidence: '', observedAt: '2026-10-19' }] };

async function fixture(page: Page) {
  await captureAnalytics(page);
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.route('**/data/bern/*.json', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ json: { generatedAt: '', discoveredAt: '', attribution: '',
      bars: name === 'coffee.json' || name === 'locations.json' ? [venue] : [] } });
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: correct a website on mobile, reload, edit again and remove the link`, async ({ page }) => {
    await fixture(page);
    const corrections: VenueCorrection[] = [], submissions: any[] = [];
    await page.route('**/api/prices?city=bern', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { entries: [], venues: [], venueCorrections: corrections } });
      const body = route.request().postDataJSON(); submissions.push(body);
      const correction = { barId: body.barId, revision: corrections.length + 1, updatedAt: '2026-10-20',
        changes: { ...corrections.at(-1)?.changes, ...body.changes, website: body.changes.website || null } };
      corrections.splice(0, corrections.length, correction);
      return route.fulfill({ json: { correction } });
    });
    await page.goto(`${language === 'en' ? '/en' : ''}/bern?drink=coffee&bar=node%2F123`);
    const detail = page.locator('#detail');
    const edit = language === 'en' ? 'Correct venue details' : 'Lokal korrigieren';
    const save = language === 'en' ? 'Save correction' : 'Korrektur speichern';
    await detail.getByRole('button', { name: edit, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: edit, exact: true });
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(venue.name);
    await expect(dialog.getByLabel('Website (optional)', { exact: true })).toHaveValue(venue.website!);
    await dialog.getByLabel('Website (optional)', { exact: true }).fill('https://correct.example/');
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await dialog.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.screenshot({ path: `test-results/venue-correction-${language}.png` });
    await dialog.getByRole('button', { name: save, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(submissions).toEqual([{ action: 'correctVenue', barId: venue.id, revision: 0, changes: { website: 'https://correct.example/' } }]);
    await expect(detail.getByRole('link', { name: 'Website', exact: true })).toHaveAttribute('href', 'https://correct.example/');
    await expect(detail).toContainText('CHF 4.00');
    await page.reload();
    await expect(detail.getByRole('link', { name: 'Website', exact: true })).toHaveAttribute('href', 'https://correct.example/');
    await detail.getByRole('button', { name: edit, exact: true }).click();
    await expect(dialog.getByLabel('Website (optional)', { exact: true })).toHaveValue('https://correct.example/');
    await dialog.getByLabel('Website (optional)', { exact: true }).fill('');
    await dialog.getByRole('button', { name: save, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(submissions[1]).toMatchObject({ revision: 1, changes: { website: '' } });
    await expect(detail.getByRole('link', { name: 'Website', exact: true })).toHaveCount(0);
    await expect(detail).toContainText('CHF 4.00');
    await page.reload();
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('link', { name: 'Website', exact: true })).toHaveCount(0);
  });
}

test('failed corrections keep the input, and cancelling makes no write', async ({ page }) => {
  await fixture(page);
  let writes = 0;
  await page.route('**/api/prices?city=bern', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { entries: [], venues: [] } });
    writes++;
    return route.fulfill({ status: 409, json: { error: 'Dieses Lokal wurde inzwischen geändert. Bitte neu laden und die Korrektur erneut prüfen.' } });
  });
  await page.goto('/bern?drink=coffee&bar=node%2F123');
  await page.getByRole('button', { name: 'Lokal korrigieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lokal korrigieren', exact: true });
  await dialog.getByRole('button', { name: 'Korrektur speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Bitte mindestens eine Angabe ändern.');
  expect(writes).toBe(0);
  await dialog.getByLabel('Website (optional)').fill('https://correct.example/');
  await dialog.getByRole('button', { name: 'Korrektur speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('inzwischen geändert');
  await expect(dialog.getByLabel('Website (optional)')).toHaveValue('https://correct.example/');
  await expect(dialog.getByRole('button', { name: 'Korrektur speichern', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Schliessen', exact: true }).click();
  expect(writes).toBe(1);
  await expect(page.locator('#detail').getByRole('link', { name: 'Website', exact: true })).toHaveAttribute('href', venue.website!);
});
