import { test, expect, type Page } from '@playwright/test';
const venue = { id: 'node/123', name: 'Schutz Café', address: 'Teststrasse 1', postcode: '8004', website: 'https://old.example/', lat: 47.38, lon: 8.53, type: 'cafe', outdoor: false, openingHours: null, checkedAt: null, scrapeStatus: 'ok', offers: [{ name: 'Espresso', coffeeType: 'espresso', priceChf: 4, volumeMl: null, alcoholFree: true, confidence: 'automatic', sourceUrl: '', evidence: '', observedAt: '2026-10-21' }] };
async function fixture(page: Page, venues = [venue]) {
  await page.route('**/api/tip?*', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
  await page.route('**/data/*.json', route => route.fulfill({ json: { bars: /coffee|locations/.test(route.request().url()) ? venues : [], generatedAt: '', discoveredAt: '', attribution: '' } }));
}
// Keep testing the dormant account flow without exposing it in the application.
async function mountAccount(page: Page) {
  await expect(page.locator('.app-footer')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Konto erstellen|Mein Konto|Create account|My account)$/ })).toHaveCount(0);
  await page.evaluate(async () => {
    const modulePath = '/src/contribution-security.ts';
    const { accountControl } = await import(modulePath);
    accountControl(document.querySelector('.app-footer'));
  });
}
test('account security dialogs stay distinct, wrong codes can be retried, and logout handles failure', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?*', route => route.fulfill({ contentType: 'application/javascript', body: `window.turnstile = { render(container, options) { const button = document.createElement('button'); button.textContent = 'Testprüfung abschliessen'; button.onclick = () => options.callback('email-token'); container.append(button); return 'widget'; }, remove() {} };` }));
  let verified = false, logoutAttempts = 0;
  await page.route('**/api/community-auth', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { verified, mailReady: true, protection: true, siteKey: 'test-site', emailRequired: false } });
    const body = route.request().postDataJSON();
    if (body.action === 'request') {
      expect(body.botToken).toBe('email-token');
      return route.fulfill({ json: { challenge: 'challenge' } });
    }
    if (body.action === 'confirm') {
      if (body.code !== '123456') return route.fulfill({ status: 401, json: { error: 'Der Code stimmt nicht. Bitte erneut eingeben.' } });
      verified = true;
    }
    if (body.action === 'logout') {
      if (++logoutAttempts === 1) return route.fulfill({ status: 503, json: { error: 'Bestätigung gerade nicht verfügbar. Bitte erneut versuchen.' } });
      verified = false;
    }
    return route.fulfill({ json: { verified } });
  });
  await page.goto('/');
  await mountAccount(page);
  await page.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
  const account = page.getByRole('dialog', { name: 'Konto erstellen oder anmelden', exact: true });
  await account.getByLabel('E-Mail-Adresse').fill('reader@example.org');
  await account.getByRole('button', { name: 'Code senden' }).click();
  const security = page.getByRole('dialog', { name: 'Kurze Sicherheitsprüfung', exact: true });
  await expect(security).toBeVisible();
  await security.getByRole('button', { name: 'Testprüfung abschliessen' }).click();
  await account.getByLabel('Sechsstelliger Code').fill('000000');
  await account.getByRole('button', { name: 'Bestätigen und fortfahren' }).click();
  await expect(account.getByRole('status')).toContainText('Der Code stimmt nicht');
  await account.getByLabel('Sechsstelliger Code').fill('123456');
  await account.getByRole('button', { name: 'Bestätigen und fortfahren' }).click();
  await expect(page.locator('dialog.contribution-security')).toHaveCount(0);
  await page.reload();
  await mountAccount(page);
  await page.getByRole('button', { name: 'Mein Konto', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'E-Mail bestätigt' });
  await details.getByRole('button', { name: 'Abmelden' }).click();
  await expect(details.getByRole('status')).toContainText('Bitte erneut versuchen');
  await Promise.all([page.waitForEvent('load'), details.getByRole('button', { name: 'Abmelden' }).click()]);
  expect(verified).toBe(false);
  await expect(page.getByRole('button', { name: /^(Konto erstellen|Mein Konto)$/ })).toHaveCount(0);
  await expect(page.locator('dialog.contribution-security')).toHaveCount(0);
});
for (const width of [320, 1280]) {
  test(`dormant account control supports optional email sign-in at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page);
    await page.route('**/api/tip?*', route => route.fulfill({ json: { enabled: true, amount: 550, publishableKey: 'pk_test_public' } }));
    await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
    let verified = false;
    const actions: string[] = [];
    await page.route('**/api/community-auth', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { mailReady: true, verified, emailRequired: false, protection: false, paused: false } });
      const body = route.request().postDataJSON(); actions.push(body.action);
      if (body.action === 'confirm') verified = true;
      return route.fulfill({ json: body.action === 'request' ? { challenge: 'test-challenge' } : { verified } });
    });
    await page.goto('/');
    await mountAccount(page);
    const account = page.locator('.app-footer').getByRole('button', { name: 'Konto erstellen', exact: true });
    await expect(account).toBeVisible();
    await expect(page.locator('#tip-coffee')).toHaveText('Kaffee spendieren · CHF 5.50');
    expect(await page.locator('.app-footer').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/wobillig-footer-account-${width}.png` });
    await account.click();
    const dialog = page.getByRole('dialog', { name: 'Konto erstellen oder anmelden' });
    await expect(dialog).toContainText('Die E-Mail-Bestätigung ist freiwillig.');
    await dialog.getByLabel('E-Mail-Adresse').fill('reader@example.org');
    await dialog.getByRole('button', { name: 'Code senden' }).click();
    await dialog.getByLabel('Sechsstelliger Code').fill('123456');
    await dialog.getByRole('button', { name: 'Bestätigen und fortfahren' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.app-footer').getByRole('button', { name: 'Mein Konto', exact: true })).toBeVisible();
    expect(actions).toEqual(['request', 'confirm']);
  });
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
test('shared manual maps show editing controls for visitors without an account', async ({ page }) => {
  await fixture(page);
  const map = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Geteilte Map', createdAt: '', canEdit: true, entries: [] };
  await page.route('**/api/prices?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map } : { entries: [] } }));
  await page.goto(`/?map=${map.id}`);
  await expect(page.locator('#custom-map-name')).toHaveText(map.name);
  await expect(page.locator('#map-add-entry')).toBeVisible();
  await page.locator('#map-add-entry').click();
  await expect(page.locator('#map-entry-dialog')).toBeVisible();
  await expect(page.locator('#map-share')).toBeVisible();
});

for (const width of [320, 390]) {
  test(`legacy map recovery restores adding places and publication requests at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const second = { ...venue, id: 'node/second', name: 'Zweites Café', lon: 8.535 };
    await fixture(page, [venue, second]);
    await page.route('**/api/community-auth', route => route.fulfill({ json: { verified: false, emailRequired: false, protection: false } }));
    const map = { id: '52251319-7e51-44e3-b6c0-5f3105d2f22e', name: 'falafel', createdAt: '2026-10-20', canEdit: false,
      entries: [{ venue, product: 'Falafel', priceChf: 4.59, revision: 1, updatedAt: '2026-10-20' }], publication: undefined as any };
    const actions: string[] = [];
    await page.route('**/api/prices?*', route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); actions.push(body.action);
        if (body.action === 'recoverMap') {
          expect(body).toMatchObject({ mapId: map.id, recoveryToken: 'private-recovery-token' });
          map.canEdit = true;
        } else if (body.action === 'saveMapEntry') {
          expect(body.barId).toBe(second.id);
          map.entries.push({ venue: second, product: body.product, priceChf: body.priceChf, revision: 1, updatedAt: '2026-10-21' });
        } else if (body.action === 'requestMapPublication') {
          map.publication = { status: 'pending', requestedAt: '2026-10-21', fingerprint: 'test' };
        } else throw new Error(`Unexpected action: ${body.action}`);
        return route.fulfill({ json: { map } });
      }
      return route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map } : { entries: [] } });
    });
    await page.goto(`/?map=${map.id}#recover=private-recovery-token`);
    await expect(page.locator('#map-add-entry')).toBeVisible();
    await expect(page.locator('#map-publish')).toBeEnabled();
    await expect(page).not.toHaveURL(/recover|private-recovery-token/);
    expect(await page.locator('a[href*="private-recovery-token"]').count()).toBe(0);
    await page.locator('#map-add-entry').click();
    const entry = page.locator('#map-entry-dialog');
    await entry.getByRole('combobox').fill('Zweites');
    await page.locator('#map-venue-suggestions').getByRole('option').first().click();
    await entry.getByLabel('Produkt / Menge').fill('Falafel');
    await entry.getByLabel('Preis in CHF').fill('5.50');
    await entry.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(entry).toBeHidden();
    await expect(page.locator('#custom-map-summary')).toContainText('2 Lokale');
    await page.reload();
    await expect(page.locator('#map-add-entry')).toBeVisible();
    await expect(page.locator('#map-publish')).toBeEnabled();
    await page.screenshot({ path: `/tmp/wobillig-map-recovered-${width}.png` });
    await page.locator('#map-publish').click();
    await expect(page.locator('#custom-map-visibility')).toContainText('Zur Prüfung eingereicht');
    expect(actions).toEqual(['recoverMap', 'saveMapEntry', 'requestMapPublication']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
