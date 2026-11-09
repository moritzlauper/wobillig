import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';
import {
  alertFilter, apartmentKinds, cheapApartments, describeApartmentFilter, filterApartments, emptyApartmentFilter, matchesApartment, parseApartmentFilter, slimApartmentData, sortApartments,
  type Apartment, type ApartmentData, type ApartmentFilter,
} from '../src/apartment-data';
import { translate } from '../src/i18n';
import { emptyState, WriteConflict, type Store } from '../server/prices';

const mocks = vi.hoisted(() => ({ store: vi.fn(), alertStore: vi.fn(), send: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mocks.send, close: vi.fn() }) } }));
vi.mock('../server/apartments.js', async original => ({ ...await original<typeof import('../server/apartments')>(), apartmentStore: mocks.alertStore }));
import handler from '../api/apartments';
import {
  alertMail, confirmAlert, confirmationMail, createAlert, dispatchAlerts, removeAlert,
  type ApartmentAlert, type ApartmentState, type ApartmentStore, type Mail,
} from '../server/apartments';

const now = Date.parse('2026-11-09T10:00:00Z');
const listing = (id: string, values: Partial<Apartment> = {}): Apartment => ({
  id, links: [{ quelle: 'flatfox', url: `https://flatfox.ch/de/wohnung/${id}/` }], titel: `Wohnung ${id}`, art: 'wohnung',
  strasse: 'Langstrasse 1', plz: '8004', ort: 'Zürich', lon: 8.528, lat: 47.378, zimmer: 3, flaeche: 70, miete: 2100,
  bezug: 'sofort', bild: null, erstGesehen: '2026-11-09T09:00:00Z', ...values,
});
const filterWith = (values: Partial<ApartmentFilter>) => ({ ...emptyApartmentFilter(), ...values });
const de = (text: string, vars?: Record<string, string | number>) => translate('de', text, vars);

describe('apartment filter', () => {
  it('applies rent, rooms, area, type, source and text like angebunden', () => {
    const a = listing('a');
    const ctx = { now };
    expect(matchesApartment(a, filterWith({}), ctx)).toBe(true);
    expect(matchesApartment(a, filterWith({ mieteMax: 2000 }), ctx)).toBe(false);
    expect(matchesApartment(listing('b', { miete: null }), filterWith({ mieteMax: 3000 }), ctx)).toBe(false);
    expect(matchesApartment(a, filterWith({ zimmerMin: 3, zimmerMax: 3.5 }), ctx)).toBe(true);
    expect(matchesApartment(a, filterWith({ zimmerMin: 3.5 }), ctx)).toBe(false);
    expect(matchesApartment(a, filterWith({ flaecheMin: 80 }), ctx)).toBe(false);
    expect(matchesApartment(a, filterWith({ arten: ['wg'] }), ctx)).toBe(false);
    expect(matchesApartment(a, filterWith({ quellenAus: ['flatfox'] }), ctx)).toBe(false);
    // A listing on two portals stays as long as one of them is selected.
    expect(matchesApartment(listing('c', { links: [{ quelle: 'flatfox', url: 'https://flatfox.ch/x' }, { quelle: 'ronorp', url: 'https://ronorp.net/x' }] }), filterWith({ quellenAus: ['flatfox'] }), ctx)).toBe(true);
    expect(matchesApartment(a, filterWith({ text: 'langstrasse 8004' }), ctx)).toBe(true);
    expect(matchesApartment(a, filterWith({ text: 'seefeld' }), ctx)).toBe(false);
  });

  it('handles lease length, features, doubts, new and saved listings', () => {
    const ctx = { now, saved: new Set(['a']) };
    const short = listing('s', { befristet: true, befristetBis: '2027-02-01' });
    const long = listing('l', { befristet: true, befristetBis: '2028-06-01' });
    expect(matchesApartment(short, filterWith({ dauer: 'unbefristet' }), ctx)).toBe(false);
    expect(matchesApartment(short, filterWith({ dauer: 'lang' }), ctx)).toBe(false);
    expect(matchesApartment(long, filterWith({ dauer: 'lang' }), ctx)).toBe(true);
    expect(matchesApartment(listing('a'), filterWith({ dauer: 'befristet' }), ctx)).toBe(false);
    expect(matchesApartment(listing('f', { merkmale: ['balkon'] }), filterWith({ merkmale: ['balkon', 'lift'] }), ctx)).toBe(false);
    expect(matchesApartment(listing('f', { merkmale: ['balkon', 'lift'] }), filterWith({ merkmale: ['balkon', 'lift'] }), ctx)).toBe(true);
    expect(matchesApartment(listing('t', { tausch: true }), filterWith({ ohneZweifel: true }), ctx)).toBe(false);
    expect(matchesApartment(listing('old', { erstGesehen: '2026-11-01T00:00:00Z' }), filterWith({ nurNeu: true }), ctx)).toBe(false);
    expect(matchesApartment(listing('a'), filterWith({ nurGemerkt: true }), ctx)).toBe(true);
    expect(matchesApartment(listing('b'), filterWith({ nurGemerkt: true }), ctx)).toBe(false);
  });

  it('filters by drawn areas and Kreise', () => {
    const square = { punkte: [[8.52, 47.37], [8.54, 47.37], [8.54, 47.39], [8.52, 47.39]] as [number, number][] };
    const inside = listing('in'), outside = listing('out', { lon: 8.6, lat: 47.4 });
    expect(matchesApartment(inside, filterWith({ gebiete: [square] }), { now })).toBe(true);
    expect(matchesApartment(outside, filterWith({ gebiete: [square] }), { now })).toBe(false);
    const district = ({ lon }: { lon: number }) => lon < 8.55 ? 4 : 7;
    expect(matchesApartment(inside, filterWith({ kreise: [4] }), { now, district })).toBe(true);
    expect(matchesApartment(outside, filterWith({ kreise: [4] }), { now, district })).toBe(false);
    // Kreis or drawn area: either is enough.
    expect(matchesApartment(outside, filterWith({ kreise: [7], gebiete: [square] }), { now, district })).toBe(true);
    expect(matchesApartment(listing('x', { lat: null, lon: null }), filterWith({ kreise: [4] }), { now, district })).toBe(false);
  });

  it('sorts like the apartment search', () => {
    const list = [listing('a', { miete: 2000, flaeche: 40 }), listing('b', { miete: 1500, flaeche: 60 }), listing('c', { miete: null, flaeche: 90 })];
    expect(sortApartments(list, 'guenstig').map(i => i.id)).toEqual(['b', 'a', 'c']);
    expect(sortApartments(list, 'm2').map(i => i.id)).toEqual(['b', 'a', 'c']);
    expect(sortApartments(list, 'gross').map(i => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('cleans filters from the browser and drops page-only switches for alerts', () => {
    const parsed = parseApartmentFilter({ mieteMax: 1700, zimmerMin: -1, arten: ['wohnung', 'boot'], quellenAus: ['flatfox', 'x'], kreise: [4, 4, 13],
      gebiete: [{ punkte: [[8.5, 47.3], [8.6, 47.3]] }, { punkte: [[8.5, 47.3], [8.6, 47.3], [8.6, 47.4]] }], sorte: 'evil', nurGemerkt: true, text: 'x'.repeat(500) });
    expect(parsed).toMatchObject({ mieteMax: 1700, zimmerMin: null, arten: ['wohnung'], quellenAus: ['flatfox'], kreise: [4], sorte: 'neu' });
    expect(parsed.gebiete).toHaveLength(1);
    expect(parsed.text).toHaveLength(120);
    expect(alertFilter(parsed)).toMatchObject({ nurGemerkt: false, nurNeu: false });
    expect(parseApartmentFilter('nonsense')).toEqual(emptyApartmentFilter());
  });

  it('«Günstig» keeps the cheapest third per type and room count, only with enough listings', () => {
    const rooms = (art: Apartment['art'], zimmer: number, prices: number[]) => prices.map((miete, k) => listing(`${art}${zimmer}-${k}`, { art, zimmer, miete }));
    // 10 WG rooms 700–1600 and 60 three-room flats 2000–7900: each group keeps its cheapest third.
    const list = [...rooms('wg', 1, [700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600]), ...rooms('wohnung', 3, Array.from({ length: 60 }, (_, k) => 2000 + k * 100))];
    const cheap = cheapApartments(list);
    expect(cheap.applied).toBe(true);
    expect(Math.max(...cheap.list.filter(i => i.art === 'wg').map(i => i.miete!))).toBe(1000);
    expect(Math.max(...cheap.list.filter(i => i.art === 'wohnung').map(i => i.miete!))).toBe(3900);
    // Without a price a listing cannot count as cheap in a filtered group.
    expect(cheapApartments([...list, listing('unknown', { zimmer: 3, miete: null })]).list.some(i => i.id === 'unknown')).toBe(false);
    // A small group stays whole.
    const houses = rooms('haus', 5, [5000, 9000]);
    expect(cheapApartments([...list, ...houses]).list.filter(i => i.art === 'haus')).toHaveLength(2);
    // Few listings: nothing filtered.
    expect(cheapApartments(list.slice(0, 30))).toMatchObject({ applied: false });
    // A rent limit of its own switches it off.
    const all = [...apartmentKinds];
    expect(filterApartments(list, filterWith({ arten: all }), { now }).list).toHaveLength(cheap.list.length);
    expect(filterApartments(list, filterWith({ arten: all, mieteMax: 10000 }), { now }).list).toHaveLength(list.length);
    expect(filterApartments(list, filterWith({ arten: all, guenstig: false }), { now }).list).toHaveLength(list.length);
  });

  it('names a search in a few words', () => {
    expect(describeApartmentFilter(filterWith({ mieteMax: 1700, zimmerMin: 2, zimmerMax: 4, kreise: [4] }), de)).toBe('Wohnung · bis CHF 1’700 · 2–4 Zi. · Kreis 4');
    expect(describeApartmentFilter(filterWith({ arten: ['wg'] }), de)).toBe('Günstig · WG-Zimmer');
    expect(describeApartmentFilter(filterWith({}), de)).toBe('Günstig · Wohnung');
    expect(describeApartmentFilter(filterWith({ arten: [...apartmentKinds], guenstig: false }), de)).toBe('Alle Wohnungen');
    expect(describeApartmentFilter(filterWith({ arten: [...apartmentKinds], zimmerMin: 2.5, guenstig: false }), (text, vars) => translate('en', text, vars))).toBe('from 2.5 rooms');
  });

  it('keeps only what the map needs from the collector file', () => {
    const slim = slimApartmentData({ erstellt: '2026-11-09T10:00:00Z', haeuser: 47085, quellen: [{ id: 'flatfox', name: 'Flatfox', anzahl: 1, ok: true, zuletzt: null }],
      inserate: [{ ...listing('a'), oev: 25, oevRang: 100, kultur: 50, kulturRang: 200 }, { id: 'broken' }], gesehen: { a: [] }, ki: {}, seiten: {} });
    expect(Object.keys(slim)).toEqual(['erstellt', 'quellen', 'inserate']);
    expect(slim.inserate.map(i => i.id)).toEqual(['a']);
    // Transit and culture stay on angebunden.
    expect(slim.inserate[0]).not.toHaveProperty('oev');
    expect(slim.inserate[0]).not.toHaveProperty('kulturRang');
    expect(() => slimApartmentData({})).toThrow();
  });
});

function memoryStore(initial: ApartmentState = { alerts: [] }): ApartmentStore & { state: () => ApartmentState } {
  let state = structuredClone(initial), version = 0;
  return {
    read: async () => ({ state: structuredClone(state), etag: String(version) }),
    write: async (next, etag) => { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
    state: () => state,
  };
}
const data = (inserate: Apartment[], erstellt = '2026-11-09T10:00:00Z'): ApartmentData => ({ erstellt, quellen: [], inserate });

describe('apartment alerts', () => {
  it('needs a confirmed email before anything is sent', async () => {
    const store = memoryStore();
    const alert = await createAlert(store, { email: ' Anna@Example.org ', filter: { mieteMax: 2500, nurGemerkt: true }, locale: 'de' }, now);
    expect(alert).toMatchObject({ email: 'anna@example.org', status: 'pending', name: 'Wohnung · bis CHF 2’500' });
    expect(alert.filter.nurGemerkt).toBe(false);
    const confirmation = confirmationMail(alert);
    expect(confirmation.html).toContain(`bestaetigen=${alert.confirmToken}`);
    expect(confirmation.subject).toBe('Suchabo bestätigen: Wohnung · bis CHF 2’500');

    const sent: Mail[] = [];
    await dispatchAlerts(store, data([listing('a')]), async mail => { sent.push(mail); });
    expect(sent).toEqual([]);

    await expect(confirmAlert(store, 'x'.repeat(32))).rejects.toThrow('abgelaufen');
    expect(await confirmAlert(store, alert.confirmToken)).toMatchObject({ id: alert.id, token: alert.token });
    await expect(confirmAlert(store, alert.confirmToken)).rejects.toThrow('schon verwendet');
    expect(store.state().alerts[0]).toMatchObject({ status: 'active' });
    expect(store.state().alerts[0].confirmToken).toBeUndefined();
  });

  it('welcomes with today’s matches, then mails only new listings, each once', async () => {
    const store = memoryStore();
    const alert = await createAlert(store, { email: 'anna@example.org', filter: { mieteMax: 2500 }, locale: 'de' }, now);
    await confirmAlert(store, alert.confirmToken);
    const sent: Mail[] = [];
    const send = async (mail: Mail) => { sent.push(mail); };

    await dispatchAlerts(store, data([listing('a'), listing('expensive', { miete: 4000 })]), send);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Dein Suchabo «Wohnung · bis CHF 2’500» ist aktiv');
    expect(sent[0].html).toContain('Wohnung a');
    expect(sent[0].html).not.toContain('Wohnung expensive');
    expect(sent[0].unsubscribe).toContain(`/api/apartments?unsubscribe=${alert.token}`);
    expect(sent[0].html).toContain(`abmelden=${alert.token}`);

    // Nothing new: no email.
    await dispatchAlerts(store, data([listing('a')], '2026-11-09T10:05:00Z'), send);
    expect(sent).toHaveLength(1);

    // One new listing: the subject names it.
    await dispatchAlerts(store, data([listing('a'), listing('b', { erstGesehen: '2026-11-09T10:07:00Z', miete: 1990, zimmer: 2.5, strasse: 'Bäckerstrasse 5' })], '2026-11-09T10:10:00Z'), send);
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toBe('Neue Wohnung: CHF 1’990, 2.5 Zi., Bäckerstrasse 5');
    expect(sent[1].text).toContain('https://flatfox.ch/de/wohnung/b/');
    // «Auf der Karte ansehen» names the listing and its original link, so it is found even after its id changed.
    expect(sent[1].html).toContain(`?map=wohnungen&amp;inserat=b&amp;u=${encodeURIComponent('https://flatfox.ch/de/wohnung/b/')}`);

    // A listing that disappears and comes back is not new.
    await dispatchAlerts(store, data([listing('b', { erstGesehen: '2026-11-09T10:20:00Z' })], '2026-11-09T10:20:00Z'), send);
    expect(sent).toHaveLength(2);
  });

  it('retries on the next run when sending fails', async () => {
    const store = memoryStore();
    const alert = await createAlert(store, { email: 'anna@example.org', filter: {}, locale: 'en' }, now);
    await confirmAlert(store, alert.confirmToken);
    const failed = await dispatchAlerts(store, data([listing('a')]), async () => { throw new Error('smtp down'); });
    expect(failed).toMatchObject({ mails: 0, failed: 1 });
    expect(store.state().alerts[0].welcomed).toBe(false);
    const sent: Mail[] = [];
    await dispatchAlerts(store, data([listing('a')]), async mail => { sent.push(mail); });
    expect(sent[0].subject).toBe('Your alert “Cheap · Apartment” is active');
  });

  it('defers alerts beyond the per-run limit', async () => {
    const store = memoryStore();
    for (const email of ['a@example.org', 'b@example.org', 'c@example.org']) {
      const alert = await createAlert(store, { email, filter: {}, locale: 'de' }, now);
      await confirmAlert(store, alert.confirmToken);
    }
    const result = await dispatchAlerts(store, data([listing('a')]), async () => undefined, { maxMails: 2 });
    expect(result).toMatchObject({ active: 3, mails: 2, deferred: 1 });
    expect(store.state().alerts.filter(alert => alert.welcomed)).toHaveLength(2);
  });

  it('forgets unconfirmed alerts after 48 hours and limits alerts per address', async () => {
    const store = memoryStore();
    await createAlert(store, { email: 'old@example.org', filter: {}, locale: 'de' }, Date.now() - 49 * 3600000);
    await dispatchAlerts(store, data([]), async () => undefined);
    expect(store.state().alerts).toEqual([]);
    for (let k = 0; k < 10; k++) await createAlert(store, { email: 'many@example.org', filter: {}, locale: 'de' });
    await expect(createAlert(store, { email: 'many@example.org', filter: {}, locale: 'de' })).rejects.toThrow('zehn Suchabos');
    await expect(createAlert(store, { email: 'not-an-email', filter: {}, locale: 'de' })).rejects.toThrow('gültige E-Mail');
  });

  it('unsubscribes with the token from every email', async () => {
    const store = memoryStore();
    const alert = await createAlert(store, { email: 'anna@example.org', filter: {}, locale: 'de' }, now);
    expect(await removeAlert(store, alert.token)).toMatchObject({ removed: true });
    expect(await removeAlert(store, alert.token)).toMatchObject({ removed: false });
    await expect(removeAlert(store, 'short')).rejects.toThrow('ungültig');
  });

  it('escapes listing text and only links https sources in emails', () => {
    const alert = { id: '1', email: 'a@example.org', name: '<b>Suche</b>', locale: 'de', filter: emptyApartmentFilter(), created: '', status: 'active',
      token: 't'.repeat(32), welcomed: true, checkedUntil: null, known: [] } as ApartmentAlert;
    const mail = alertMail(alert, [listing('x', { titel: '<script>alert(1)</script>', bild: 'javascript:alert(1)', links: [{ quelle: 'ronorp', url: 'javascript:alert(1)' }] })], false);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).toContain('&lt;b&gt;Suche&lt;/b&gt;');
  });
});

describe('apartments API', () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret'); vi.stubEnv('VERCEL_ENV', 'production');
    for (const [key, value] of Object.entries({ SMTP_HOST: 'mail.example.org', SMTP_USER: 'hello@wobillig.ch', SMTP_PASSWORD: 'secret', COMMUNITY_EMAIL_FROM: 'Wobillig <hello@wobillig.ch>', APARTMENT_ALERTS_SECRET: 'a-long-random-test-secret' })) vi.stubEnv(key, value);
    store = memoryStore();
    mocks.alertStore.mockReset().mockReturnValue(store);
    mocks.send.mockReset().mockResolvedValue({});
    let security: ReturnType<typeof emptyState> = emptyState(), version = 0;
    mocks.store.mockReset().mockReturnValue({ read: async () => ({ state: structuredClone(security), etag: String(version) }),
      write: async (next: typeof security, etag?: string) => { if (etag !== String(version)) throw new WriteConflict(); security = structuredClone(next); version++; } } satisfies Store);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ erstellt: '2026-11-09T10:00:00Z', haeuser: 1, quellen: [], inserate: [listing('a')], gesehen: {} }))));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  async function call(method: string, url: string, body?: object, headers: Record<string, string> = {}) {
    const req = { method, url, body, headers: { host: 'wobillig.ch', origin: 'https://wobillig.ch', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'ip-1' } } as unknown as IncomingMessage & { body?: unknown };
    const out: Record<string, string> = {}; let text = '';
    const res = { statusCode: 0, setHeader: (k: string, v: string) => { out[k] = v; }, end: (v = '') => { text = v; } } as unknown as ServerResponse;
    await handler(req, res);
    return { status: res.statusCode, body: JSON.parse(text), headers: out };
  }

  it('serves the listings without the collector memory, cached at the edge', async () => {
    const result = await call('GET', '/api/apartments?data=1');
    expect(result.status).toBe(200);
    expect(result.body.gesehen).toBeUndefined();
    expect(result.body.inserate).toHaveLength(1);
    expect(result.headers['Cache-Control']).toContain('s-maxage=120');
  });

  it('signs up with a confirmation email and refuses other sites', async () => {
    const result = await call('POST', '/api/apartments', { action: 'subscribe', email: 'anna@example.org', filter: { mieteMax: 1700 }, locale: 'de' });
    expect(result.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0]).toMatchObject({ subject: 'Suchabo bestätigen: Wohnung · bis CHF 1’700' });
    expect(store.state().alerts[0].status).toBe('pending');
    const foreign = await call('POST', '/api/apartments', { action: 'subscribe', email: 'anna@example.org', filter: {} }, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('dispatches only with the secret', async () => {
    expect((await call('POST', '/api/apartments?action=dispatch')).status).toBe(401);
    expect((await call('POST', '/api/apartments?action=dispatch', undefined, { authorization: 'Bearer wrong-secret-of-same-size' })).status).toBe(401);
    const ok = await call('POST', '/api/apartments?action=dispatch', undefined, { authorization: 'Bearer a-long-random-test-secret' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ active: 0, mails: 0 });
    // Without a dedicated secret, the workflow signs with an HMAC of the Blob token both sides have.
    vi.stubEnv('APARTMENT_ALERTS_SECRET', '');
    const hmac = createHmac('sha256', 'test-secret').update('wobillig-apartment-alerts').digest('hex');
    expect((await call('POST', '/api/apartments?action=dispatch', undefined, { authorization: `Bearer ${hmac}` })).status).toBe(200);
    expect((await call('POST', '/api/apartments?action=dispatch', undefined, { authorization: 'Bearer test-secret' })).status).toBe(401);
  });

  it('unsubscribes with one click from the mail program', async () => {
    const alert = await createAlert(store, { email: 'anna@example.org', filter: {}, locale: 'de' });
    const result = await call('POST', `/api/apartments?unsubscribe=${alert.token}`, undefined, { origin: '', 'content-type': 'application/x-www-form-urlencoded' });
    expect(result.status).toBe(200);
    expect(store.state().alerts).toEqual([]);
  });
});

describe('apartment alerts in the review area', () => {
  it('lists alerts newest first with shortened addresses', async () => {
    const { apartmentAlertsReviewHtml, maskEmail } = await import('../server/apartments');
    expect(maskEmail('moritz@example.ch')).toBe('mo…@example.ch');
    const base = { locale: 'de' as const, filter: emptyApartmentFilter(), token: 't', welcomed: true, checkedUntil: null, known: ['a', 'b'] };
    const html = apartmentAlertsReviewHtml({ alerts: [
      { ...base, id: '1', email: 'anna@example.org', name: 'Älteres <Abo>', created: '2026-11-01T10:00:00Z', status: 'active', lastSent: new Date().toISOString() },
      { ...base, id: '2', email: 'ben@example.org', name: 'Neues Abo', created: '2026-11-09T10:00:00Z', status: 'pending' },
    ] }, 'production');
    expect(html).not.toContain('anna@example.org');
    expect(html).toContain('an…@example.org');
    expect(html).toContain('Älteres &lt;Abo&gt;');
    expect(html.indexOf('Neues Abo')).toBeLessThan(html.indexOf('Älteres'));
    expect(html).toMatch(/<strong>1<\/strong>aktive Suchabos/);
    expect(apartmentAlertsReviewHtml(undefined, 'production')).toContain('konnten gerade nicht geladen werden');
  });
});
