import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: { entries: [], counts: {}, enabled: false } }));
});

for (const width of [390, 1280]) {
  test(`removing smart filters keeps the search closed at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('#count')).not.toHaveText('Laden …');
    const search = page.locator('#search');
    await search.fill('Kaffee unter 100 Franken mit Terrasse, jetzt offen');
    await search.press('Enter');
    await expect(page.locator('.smart-chip')).toHaveCount(2);
    const open = page.getByRole('button', { name: 'Jetzt offen entfernen' });
    if (width < 760) await open.tap(); else await open.click();
    await expect(page.locator('.smart-chip')).toHaveCount(1);
    await expect(page.locator('#search-dropdown')).toBeHidden();
    await expect(search).not.toBeFocused();
    // Keyboard removal of the last chip must not reopen the search either.
    await page.locator('.smart-chip').press('Enter');
    await expect(page.locator('#smart-chips')).toBeHidden();
    await expect(page.locator('#search-dropdown')).toBeHidden();
    await expect(search).not.toBeFocused();
    await expect(page.locator('#filters-toggle')).toBeFocused();
    await expect(page.locator('#filters')).toBeHidden();
    expect(await page.locator('#results .venue').count()).toBeGreaterThan(7);
  });
}

test('placeholder rotation stops after seven examples while all suggestions remain available', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-02T12:00:01Z'));
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  const search = page.locator('#search');
  await page.clock.runFor(300);
  const examples: string[] = [];
  for (let index = 0; index < 7; index++) {
    examples.push((await search.getAttribute('placeholder'))!);
    if (index < 6) await page.clock.runFor(4500);
  }
  expect(new Set(examples).size).toBe(7);
  expect(examples).not.toContain('Lokal, Adresse, PLZ oder Ort');
  await page.clock.runFor(120000);
  await expect(search).toHaveAttribute('placeholder', examples[6]);
  await expect(search).not.toHaveClass(/placeholder-out/);
  await search.focus();
  expect(await page.locator('#search-examples [role=option]').count()).toBeGreaterThan(7);
  await search.press('ArrowDown');
  await search.press('ArrowDown');
  await expect(page.locator('#search-examples [role=option]').nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('mobile close button dismisses smart-search suggestions without clearing the query', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  const search = page.locator('#search');
  await search.fill('Kaffee unter 5 Franken');
  await expect(page.locator('#search-dropdown')).toBeVisible();
  await page.getByRole('button', { name: 'Suche schliessen' }).click();
  await expect(page.locator('#search-dropdown')).toBeHidden();
  await expect(search).toHaveValue('Kaffee unter 5 Franken');
  await expect(search).not.toBeFocused();
});

test('history is labelled separately from examples and can be cleared', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wobillig-search-history:zurich', JSON.stringify([
    { kind: 'address', label: 'Zürich HB', lat: 47.378, lon: 8.54, origin: 'address' },
  ])));
  await page.goto('/');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  await page.locator('#search').focus();
  await expect(page.locator('#search-examples')).toBeVisible();
  await expect(page.locator('#search-history-heading')).toContainText('Letzte Suchen');
  await expect(page.locator('#search-history-heading')).toBeVisible();
  await expect(page.locator('#search-suggestions [role=option]')).toHaveCount(1);
  await expect(page.locator('#search-suggestions')).toContainText('Zürich HB');
  await page.getByRole('button', { name: 'Verlauf löschen' }).click();
  await expect(page.locator('#search-history-heading')).toBeHidden();
  await expect(page.locator('#search-suggestions [role=option]')).toHaveCount(0);
  await expect(page.locator('#search-examples')).toBeVisible();
});

test('venues of every category are found by name, and a full name opens the venue on Enter', async ({ page }) => {
  await page.goto('/?drink=beer');
  await expect(page.locator('#count')).not.toHaveText('Laden …');
  const search = page.locator('#search');
  // Café Zähringer has no beer price but is still a venue in Zürich.
  await search.click(); await search.pressSequentially('Café Zähringer');
  await expect(page.locator('#search-suggestions [data-suggestion]').first()).toContainText('Café Zähringer');
  await search.press('Enter');
  await expect(page.locator('#detail')).toContainText('Zähringerplatz 11');
  // A single category word stays a smart search.
  await search.fill(''); await search.click(); await search.pressSequentially('Pizza');
  await expect(page.locator('#search-suggestions [data-suggestion]').first()).toHaveClass(/smart-option/);
});
