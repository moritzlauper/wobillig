import { expect, test, type Page } from '@playwright/test';
import { validateInput, type PriceEntry } from '../src/community';
import type { Bar } from '../src/data';

const foodCourt: Bar = { id: 'community/food-court', name: 'Food Court', address: 'Bahnhofplatz 1', postcode: '8001',
  lat: 47.377, lon: 8.54, type: 'fast_food', website: '', outdoor: false, openingHours: null, offers: [], scrapeStatus: 'community', checkedAt: null };

async function setup(page: Page) {
  const writes: Record<string, any>[] = [], venues = [foodCourt], entries: PriceEntry[] = [];
  await page.route('**/api/prices?*', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { entries, venues } });
    const body = route.request().postDataJSON(); writes.push(body);
    if (body.action === 'addVenue') {
      const venue = { ...foodCourt, ...body.venue, id: 'community/new-venue' }; venues.push(venue);
      return route.fulfill({ json: { venue, created: true } });
    }
    const input = validateInput(body, venues);
    const entry = { id: '11111111-1111-1111-1111-111111111111', barId: input.barId, drink: input.drink,
      targetKey: '', revision: 1, updatedAt: new Date().toISOString(), venue: venues.find(bar => bar.id === input.barId),
      offer: { ...input, confidence: 'community', evidence: '' } } as PriceEntry;
    entries.push(entry); return route.fulfill({ json: { entry } });
  });
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await page.getByRole('button', { name: 'Preise ergänzen', exact: true }).click();
  return { writes, venues };
}

test('smart text needs an explicit venue and pizza portion confirmation before saving', async ({ page }) => {
  const { writes } = await setup(page);
  await expect(page.locator('#contribution-title')).toBeFocused();
  await page.screenshot({ path: 'test-results/contribution-mobile.png' });
  await page.getByLabel('Smart ergänzen', { exact: true }).fill('food court am hbn pizza margeritha für 5.-');
  await page.getByRole('button', { name: 'Eintrag vorbereiten' }).click();
  await expect(page.locator('#contribution-preview')).toHaveText('Pizza Margherita · CHF 5.00');
  expect(writes).toHaveLength(0);
  await page.locator('#contribution-matches').getByRole('button', { name: /Food Court.*Bahnhofplatz 1/ }).click();
  await expect(page.locator('#entry-price')).toHaveValue('5');
  await expect(page.locator('#entry-drink')).toHaveValue('pizza');
  await page.screenshot({ path: 'test-results/contribution-smart-review.png' });
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByLabel('Der Preis gilt für eine ganze, normale Margherita im Lokal.').check();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('#price-dialog')).not.toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ barId: foodCourt.id, drink: 'pizza', priceChf: 5, name: 'Pizza Margherita' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('uncertain prices remain empty and changing venue keeps the sentence', async ({ page }) => {
  const { writes } = await setup(page);
  await page.locator('#contribution-text').fill('Food Court Cappuccino ab 5 CHF');
  await page.getByRole('button', { name: 'Eintrag vorbereiten' }).click();
  await page.locator('#contribution-matches button').first().click();
  await expect(page.locator('#entry-price')).toHaveValue('');
  await expect(page.locator('#entry-coffee')).toHaveValue('cappuccino');
  await page.getByRole('button', { name: 'Anderes Lokal wählen' }).click();
  await expect(page.locator('#contribution-venue')).toBeVisible();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await expect(page.locator('#contribution-text')).toHaveValue('Food Court Cappuccino ab 5 CHF');
  await page.locator('#contribution-text').fill('Food Court Getränk für 5 CHF');
  await page.getByRole('button', { name: 'Eintrag vorbereiten' }).click();
  await page.locator('#contribution-matches button').first().click();
  await page.locator('#entry-drink').selectOption('coffee');
  await expect(page.locator('#entry-name')).toHaveValue('');
  await page.locator('#entry-coffee').selectOption('espresso');
  await expect(page.locator('#entry-name')).toHaveValue('Espresso');
  expect(writes).toHaveLength(0);
});

test('a product without a venue asks for a venue instead of searching for the product', async ({ page }) => {
  const { writes } = await setup(page);
  await page.locator('#contribution-text').fill('Espresso für 3 CHF');
  await page.getByRole('button', { name: 'Eintrag vorbereiten' }).click();
  await expect(page.locator('#contribution-query')).toHaveValue('');
  await expect(page.locator('#contribution-status')).toContainText('Suche nach dem Namen');
  await page.locator('#contribution-query').fill('Food Court');
  await page.locator('#contribution-matches button').first().click();
  await expect(page.locator('#entry-price')).toHaveValue('3');
  await expect(page.locator('#entry-coffee')).toHaveValue('espresso');
  expect(writes).toHaveLength(0);
});

test('a missing venue can be created and the smart price survives cancellation and completion', async ({ page }) => {
  const { writes } = await setup(page);
  await page.locator('#contribution-text').fill('Neues Testcafé Cappuccino für 4.50 CHF');
  await page.getByRole('button', { name: 'Eintrag vorbereiten' }).click();
  await page.getByRole('button', { name: 'Neues Lokal erfassen' }).click();
  await page.locator('#venue-close').click();
  await expect(page.locator('#contribution-venue')).toBeVisible();
  await page.getByRole('button', { name: 'Neues Lokal erfassen' }).click();
  await page.locator('#venue-name').fill('Neues Testcafé');
  await page.locator('#venue-type').selectOption('cafe');
  await page.locator('#venue-address').fill('Testgasse 12');
  await page.locator('#venue-postcode').fill('8001');
  await page.getByRole('button', { name: 'Kartenmitte übernehmen' }).click();
  await page.getByRole('button', { name: 'Lokal speichern', exact: true }).click();
  await expect(page.locator('#price-dialog')).toBeVisible();
  await expect(page.locator('#entry-bar-name')).toHaveValue('Neues Testcafé · Testgasse 12');
  await expect(page.locator('#entry-price')).toHaveValue('4.5');
  await expect(page.locator('#entry-coffee')).toHaveValue('cappuccino');
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('#price-dialog')).not.toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ barId: 'community/new-venue', drink: 'coffee', priceChf: 4.5 });
});

test('menu upload uses the selected venue and the existing scan path', async ({ page }) => {
  let uploaded: any;
  await page.route('**/api/scan-menu?*', async route => {
    uploaded = route.request().postDataJSON();
    return route.fulfill({ json: { entries: [], added: 0, unchanged: 1, conflicts: 0, skipped: 0 } });
  });
  const { writes } = await setup(page);
  await page.getByRole('button', { name: 'Menükarte hochladen' }).click();
  await page.getByLabel('Lokal oder Adresse', { exact: true }).fill('Food Court');
  await page.locator('#contribution-matches button').first().click();
  await expect(page.locator('#menu-scan')).toBeVisible();
  await expect(page.locator('#entry-price')).not.toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#scan-menu').click();
  await (await chooser).setFiles('tests/fixtures/menu-scan-table.jpg');
  await expect(page.locator('#price-dialog')).not.toBeVisible();
  expect(uploaded.barId).toBe(foodCourt.id);
  expect(uploaded.image.mediaType).toBe('image/jpeg');
  expect(writes).toHaveLength(0);
});

test('English manual entry and a narrow layout remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setup(page);
  await page.goto('/en');
  await expect(page.locator('#count')).not.toHaveText('Loading …');
  await page.getByRole('button', { name: 'Add prices', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Upload a menu' })).toBeVisible();
  await page.locator('#contribution-manual').click();
  await page.getByLabel('Venue or address', { exact: true }).fill('Food Court');
  await page.locator('#contribution-matches button').first().click();
  await expect(page.locator('#entry-price')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/contribution-english-narrow.png' });
});
