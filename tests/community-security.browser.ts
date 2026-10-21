import { test, expect, type Page } from '@playwright/test';
const venue = { id: 'node/123', name: 'Schutz Café', address: 'Teststrasse 1', postcode: '8004', website: 'https://old.example/', lat: 47.38, lon: 8.53, type: 'cafe', outdoor: false, openingHours: null, checkedAt: null, scrapeStatus: 'ok', offers: [{ name: 'Espresso', coffeeType: 'espresso', priceChf: 4, volumeMl: null, alcoholFree: true, confidence: 'automatic', sourceUrl: '', evidence: '', observedAt: '2026-10-21' }] };
async function fixture(page: Page) {
  await page.route('**/api/tip?*', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.route('**/data/*.json', route => route.fulfill({ json: { bars: /coffee|locations/.test(route.request().url()) ? [venue] : [], generatedAt: '', discoveredAt: '', attribution: '' } }));
}
test('email verification preserves the form and pending corrections never become public in the UI', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await fixture(page);
  const authActions: any[] = [], writes: any[] = [];
  await page.route('**/api/community-auth', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { verified: false, emailRequired: true, protection: false, paused: false } });
    const body = route.request().postDataJSON(); authActions.push(body);
    return route.fulfill({ json: body.action === 'request' ? { challenge: 'test-challenge' } : { verified: true } });
  });
  await page.route('**/api/prices?*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { entries: [], venues: [], venueCorrections: [] } });
    const body = route.request().postDataJSON(); writes.push(body);
    return route.fulfill({ json: { pending: true, correction: { barId: venue.id, revision: 1, changes: body.changes } } });
  });
  await page.goto('/?drink=coffee&bar=node%2F123');
  await page.getByRole('button', { name: 'Lokal korrigieren', exact: true }).click();
  const form = page.locator('#venue-correction-dialog');
  await form.getByLabel('Website (optional)').fill('https://new.example/');
  await form.getByRole('button', { name: 'Korrektur speichern' }).click();
  const auth = page.getByRole('dialog', { name: 'E-Mail einmalig bestätigen' });
  await expect(auth).toBeVisible(); expect(writes).toHaveLength(0);
  await auth.getByLabel('E-Mail-Adresse').fill('reader@example.org');
  await auth.getByRole('button', { name: 'Code senden' }).click();
  await expect(auth.getByLabel('Sechsstelliger Code')).toBeVisible();
  await page.screenshot({ path: '/tmp/wobillig-email-verification-320.png' });
  expect(await auth.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  await auth.getByLabel('Sechsstelliger Code').fill('123456');
  await auth.getByRole('button', { name: 'Bestätigen und fortfahren' }).click();
  await expect(auth).toBeHidden(); await expect(form).toContainText('wird vor der Veröffentlichung geprüft');
  expect(authActions.map(row => row.action)).toEqual(['request', 'confirm']);
  expect(writes).toHaveLength(1); expect(writes[0].changes.website).toBe('https://new.example/');
  await expect(page.locator('#detail').getByRole('link', { name: 'Website', exact: true })).toHaveAttribute('href', 'https://old.example/');
});
test('cancelling verification preserves form input and does not submit it', async ({ page }) => {
  await fixture(page); let writes = 0;
  await page.route('**/api/community-auth', route => route.fulfill({ json: { verified: false, emailRequired: true, protection: false, paused: false } }));
  await page.route('**/api/prices?*', route => { if (route.request().method() === 'POST') writes++; return route.fulfill({ json: { entries: [], venues: [], venueCorrections: [] } }); });
  await page.goto('/?drink=coffee&bar=node%2F123');
  await page.getByRole('button', { name: 'Lokal korrigieren', exact: true }).click();
  const form = page.locator('#venue-correction-dialog');
  await form.getByLabel('Website (optional)').fill('https://new.example/');
  await form.getByRole('button', { name: 'Korrektur speichern' }).click();
  const auth = page.getByRole('dialog', { name: 'E-Mail einmalig bestätigen' });
  await auth.getByRole('button', { name: 'Schliessen' }).click();
  await expect(form.getByLabel('Website (optional)')).toHaveValue('https://new.example/');
  await expect(form.getByRole('button', { name: 'Korrektur speichern' })).toBeEnabled(); expect(writes).toBe(0);
});
test('shared map links are read-only without owner permission', async ({ page }) => {
  await fixture(page);
  const map = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Geteilte Map', createdAt: '', canEdit: false, entries: [] };
  await page.route('**/api/prices?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map } : { entries: [] } }));
  await page.goto(`/?map=${map.id}`);
  await expect(page.locator('#custom-map-name')).toHaveText(map.name);
  await expect(page.locator('#map-add-entry')).toBeHidden(); await expect(page.locator('#map-publish-control')).toBeHidden(); await expect(page.locator('#map-withdraw')).toBeHidden();
  await expect(page.locator('#map-share')).toBeVisible();
});
