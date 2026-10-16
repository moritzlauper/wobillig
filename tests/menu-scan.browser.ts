import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const mars = JSON.parse(readFileSync('public/data/bars.json', 'utf8')).bars.find((b: { name: string }) => b.name === 'Mars Bar');
async function openForm(page: import('@playwright/test').Page) {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.goto('/?drink=beer&bar=' + encodeURIComponent(mars.id));
  await page.locator('#add-here').click();
  await expect(page.locator('#price-dialog')).toBeVisible();
  await expect(page.locator('#form-title')).toBeFocused();
}
test('a single photo choice sends the selected venue and compressed photo, then opens saved prices', async ({ page }) => {
  let uploaded: any;
  await page.route('**/api/scan-menu?*', async route => {
    uploaded = route.request().postDataJSON();
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ json: { added: 2, unchanged: 0, conflicts: 0, skipped: 0,
      entries: [300, 500].map((volume, i) => ({ id: 'scan-' + i, barId: mars.id, drink: 'beer', targetKey: 'scan-' + i, revision: 1, venue: mars, updatedAt: '2026-10-16',
        offer: { name: 'Turbinenbräu Sprint', priceChf: i ? 7.9 : 5.2, volumeMl: volume, beerType: 'draft', alcoholFree: false, sourceUrl: '', observedAt: '2026-10-16', confidence: 'ai', evidence: '', menuScan: { sha256: 'test', model: 'test' } } })) } });
  });
  await openForm(page);
  await expect(page.locator('#entry-price')).not.toBeVisible();
  const chooser = page.waitForEvent('filechooser'); await page.locator('#scan-menu').click();
  await (await chooser).setFiles('tests/fixtures/menu-scan-table.jpg');
  await expect(page.locator('#scan-status')).toBeVisible();
  await expect(page.locator('#cancel-price')).toBeDisabled();
  await expect(page.locator('#price-dialog')).not.toBeVisible();
  await expect(page.locator('#toast')).toContainText('2 Preise gespeichert');
  await expect(page.locator('#detail')).toContainText('Turbinenbräu Sprint');
  await expect(page.locator('#detail')).toContainText('KI-erkannt');
  expect(uploaded.barId).toBe(mars.id); expect(uploaded.image.mediaType).toBe('image/jpeg');
  expect(Buffer.from(uploaded.image.data, 'base64').length).toBeLessThan(2_000_000);
  expect(Object.keys(uploaded).sort()).toEqual(['barId', 'image']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
test('errors stay in the dialog and allow another photo without extra required fields', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/scan-menu?*', route => { calls++; return route.fulfill({ status: 422, json: { error: 'Bitte einen näheren, scharfen Ausschnitt fotografieren.' } }); });
  await openForm(page);
  await page.locator('#menu-photo').setInputFiles('tests/fixtures/menu-scan-unreadable.jpg');
  await expect(page.locator('#form-error')).toContainText('scharfen Ausschnitt');
  await expect(page.locator('#scan-menu')).toBeEnabled(); await expect(page.locator('#cancel-price')).toBeEnabled();
  await expect(page.locator('#manual-fields')).toBeEnabled();
  await page.locator('#menu-photo').setInputFiles('tests/fixtures/menu-scan-table.jpg');
  await expect.poll(() => calls).toBe(2);
  await page.screenshot({ path: '/tmp/wobillig-scan-mobile.png' });
});
test('manual additions and existing-price editing still work', async ({ page }) => {
  let manual: any;
  await page.route('**/api/prices?*', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { entries: [] } });
    manual = route.request().postDataJSON();
    await route.fulfill({ json: { entry: { id: 'manual', barId: mars.id, drink: 'beer', targetKey: 'manual', revision: 1, venue: mars, offer: { ...manual, confidence: 'community', evidence: '' } } } });
  });
  await page.goto('/?drink=beer&bar=' + encodeURIComponent(mars.id)); await page.locator('#add-here').click();
  await page.locator('#manual-entry > summary').click();
  await page.locator('#entry-name').fill('Test Lager'); await page.locator('#entry-price').fill('6.50');
  await page.locator('#save-price').click();
  await expect(page.locator('#price-dialog')).not.toBeVisible(); expect(manual.priceChf).toBe(6.5);
  await page.locator('#detail [data-edit]').first().click();
  await expect(page.locator('#menu-scan')).not.toBeVisible(); await expect(page.locator('#entry-price')).toBeVisible();
  await expect(page.locator('#form-title')).toBeFocused();
  await page.locator('#entry-price').click();
  await expect(page.locator('#entry-price')).toBeFocused();
});

test('opening and reopening the coffee price dialog never briefly focuses an input', async ({ page }) => {
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.goto('/?drink=coffee&bar=' + encodeURIComponent(mars.id));
  await page.locator('#add-here').waitFor();
  await page.evaluate(() => {
    (window as any).priceInputFocuses = [];
    document.querySelector('#price-dialog')!.addEventListener('focusin', event => {
      if (event.target instanceof HTMLInputElement) (window as any).priceInputFocuses.push(event.target.id);
    });
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('#add-here').click();
    await expect(page.locator('#form-title')).toBeFocused();
    expect(await page.evaluate(() => (window as any).priceInputFocuses)).toEqual([]);
    await page.locator('#manual-entry > summary').click();
    expect(await page.evaluate(() => (window as any).priceInputFocuses)).toEqual([]);
    await page.locator('#entry-name').click();
    await expect(page.locator('#entry-name')).toBeFocused();
    await page.locator('#cancel-price').click();
    await page.evaluate(() => { (window as any).priceInputFocuses = []; });
  }
});
