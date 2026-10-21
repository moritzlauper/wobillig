import { test, expect } from '@playwright/test';

const venue = { id: 'node/123', name: 'Schutz Café', address: 'Teststrasse 1', postcode: '8004', website: 'https://old.example/', lat: 47.38, lon: 8.53, type: 'cafe', outdoor: false, openingHours: null, checkedAt: null, scrapeStatus: 'ok', offers: [] };
test('mobile menu upload waits for Turnstile and publishes the returned prices directly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/tip?*', r => r.fulfill({ json: { enabled: false } }));
  await page.route('**/api/categories', r => r.fulfill({ json: { counts: {} } }));
  await page.route('**/data/*.json', r => r.fulfill({ json: { bars: [venue], generatedAt: '', discoveredAt: '', attribution: '' } }));
  await page.route('**/api/prices?*', r => r.fulfill({ json: { entries: [] } }));
  await page.route('**/api/community-auth', r => r.fulfill({ json: { verified: false, emailRequired: false, protection: true, siteKey: 'test-site-key', paused: false } }));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?*', r => r.fulfill({ contentType: 'application/javascript', body: `window.turnstile = { render(container, options) { const button = document.createElement('button'); button.textContent = 'Testprüfung abschliessen'; button.onclick = () => options.callback('test-token-' + options.action); container.append(button); return 'widget'; }, remove() {} };` }));
  let uploaded: any;
  await page.route('**/api/scan-menu?*', r => {
    uploaded = r.request().postDataJSON();
    return r.fulfill({ json: { added: 1, unchanged: 0, conflicts: 0, skipped: 0, entries: [{ id: 'scan-1', barId: venue.id, drink: 'coffee', targetKey: 'flat-white', revision: 1, venue, updatedAt: '2026-10-21', offer: { name: 'Flat White (M, 3 dl)', coffeeType: 'flat_white', priceChf: 5.3, volumeMl: null, alcoholFree: true, confidence: 'ai', sourceUrl: '', observedAt: '2026-10-21', evidence: 'M 5.3', menuScan: { sha256: 'test', model: 'test' } } }] } });
  });
  await page.goto('/?drink=coffee&bar=node%2F123');
  await page.locator('#add-here').click();
  await page.locator('#menu-photo').setInputFiles('tests/fixtures/menu-scan-table.jpg');
  const security = page.getByRole('dialog', { name: 'Kurze Sicherheitsprüfung' });
  await expect(security).toBeVisible(); expect(uploaded).toBeUndefined();
  await security.getByRole('button', { name: 'Schliessen', exact: true }).click();
  await expect(page.locator('#price-dialog')).toBeVisible();
  await expect(page.locator('#form-error')).toContainText('Dein Formular bleibt erhalten');
  expect(uploaded).toBeUndefined();
  await page.locator('#menu-photo').setInputFiles('tests/fixtures/menu-scan-table.jpg');
  await expect(security).toBeVisible();
  expect(await security.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  await security.getByRole('button', { name: 'Testprüfung abschliessen' }).click();
  await expect(page.locator('#price-dialog')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('1 Preis gespeichert');
  await expect(page.locator('#detail')).toContainText('Flat White (M, 3 dl)');
  expect(uploaded.botToken).toBe('test-token-contribute');
  expect(uploaded.barId).toBe(venue.id);
  expect(uploaded.image.mediaType).toBe('image/jpeg');
});
