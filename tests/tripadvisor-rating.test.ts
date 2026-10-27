import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Bar } from '../src/data';
import { emptyTripadvisorState, TRIPADVISOR_LIFETIME_LIMIT, tripadvisorRating, TripadvisorWriteConflict, type TripadvisorState, type TripadvisorStore } from '../server/tripadvisor-rating';

const fetchMock = vi.fn();
const bar: Bar = { id: 'node/1', name: 'Pizzeria Test', lat: 47.3745, lon: 8.5439, type: 'restaurant', address: 'Niederdorfstrasse 40',
  postcode: '8001', website: null, openingHours: null, outdoor: false, offers: [], scrapeStatus: 'partial', checkedAt: null };
const location = {
  id: 42,
  names: [{ language: 'de', value: 'Pizzeria Test', primary: true }],
  coordinates: { latitude: 47.3745, longitude: 8.5439 },
  addresses: [{ postal_code: '8001' }],
  traveler_ratings: { overall: { rating: 4.5, count: 120, icon_url: 'https://static.example/bubbles.png' } },
  urls: { tripadvisor: { main: 'https://www.tripadvisor.com/Restaurant_Review-42.html' } },
};
let state: TripadvisorState;
let store: TripadvisorStore;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function calls(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path)).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  state = emptyTripadvisorState();
  let revision = 0;
  store = {
    async read() { return { state: structuredClone(state), etag: String(revision) }; },
    async write(next, etag) {
      if (etag !== String(revision)) throw new TripadvisorWriteConflict();
      state = structuredClone(next);
      revision++;
    },
  };
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/catalog/locations/search')) return json({ data: [{ location, matched_value: { language: 'de', value: 'Pizzeria Test' } }] });
    if (url.includes('/allowlist')) return json({ added: 1, deleted: 0, no_change: 0 });
    if (url.includes('/locations/42')) return json(location);
    return new Response('', { status: 500 });
  });
});

afterEach(() => vi.unstubAllGlobals());

it('sends nothing without a key', async () => {
  expect(await tripadvisorRating(store, bar, 'Zürich', undefined)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('searches once, allowlists the ID, then reads the rating with the key in a header', async () => {
  const result = await tripadvisorRating(store, bar, 'Zürich', 'secret');
  expect(result).toEqual({ source: 'tripadvisor', rating: 4.5, reviewCount: 120,
    iconUrl: 'https://static.example/bubbles.png', url: 'https://www.tripadvisor.com/Restaurant_Review-42.html' });
  expect(calls('/catalog/locations/search')).toBe(1);
  const allowlist = fetchMock.mock.calls.find(([url]) => String(url).includes('/allowlist'))!;
  expect(JSON.parse(allowlist[1].body)).toEqual({ operation_type: 'APPEND', allowlist: [42] });
  const search = fetchMock.mock.calls.find(([url]) => String(url).includes('/catalog/locations/search'))!;
  expect(search[1].headers['X-API-Key']).toBe('secret');
  expect(String(search[0])).not.toContain('secret');
  expect(state.ids['Zürich:node/1']).toBe(42);
  // Search and details are billable. The allowlist call is not.
  expect(state.used).toBe(2);
});

it('reuses the stored ID, so later displays cost one unit each', async () => {
  await tripadvisorRating(store, bar, 'Zürich', 'secret');
  await tripadvisorRating(store, bar, 'Zürich', 'secret');
  expect(calls('/catalog/locations/search')).toBe(1);
  expect(calls('/locations/42')).toBe(2);
  expect(state.used).toBe(3);
});

it('remembers venues without a match, so they are searched only once', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('/catalog/locations/search')
    ? json({ data: [{ location: { ...location, names: [{ value: 'Ganz anderer Name', primary: true }] } }] })
    : new Response('', { status: 500 }));
  expect(await tripadvisorRating(store, bar, 'Zürich', 'secret')).toBeNull();
  expect(await tripadvisorRating(store, bar, 'Zürich', 'secret')).toBeNull();
  expect(calls('/catalog/locations/search')).toBe(1);
  expect(calls('/allowlist')).toBe(0);
  expect(state.ids['Zürich:node/1']).toBeNull();
});

it('refuses every call once the lifetime allowance is spent', async () => {
  state.used = TRIPADVISOR_LIFETIME_LIMIT;
  expect(await tripadvisorRating(store, bar, 'Zürich', 'secret')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(state.used).toBe(TRIPADVISOR_LIFETIME_LIMIT);
});

it('stops before the details call when the search uses the last unit', async () => {
  state.used = TRIPADVISOR_LIFETIME_LIMIT - 1;
  expect(await tripadvisorRating(store, bar, 'Zürich', 'secret')).toBeNull();
  expect(calls('/locations/42')).toBe(0);
  expect(state.used).toBe(TRIPADVISOR_LIFETIME_LIMIT);
});

it('rejects ratings whose icon or link is not https', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/catalog/locations/search')) return json({ data: [{ location }] });
    if (url.includes('/allowlist')) return json({ added: 1, deleted: 0, no_change: 0 });
    return json({ ...location, traveler_ratings: { overall: { rating: 4.5, count: 120, icon_url: 'http://insecure.example/x.png' } } });
  });
  expect(await tripadvisorRating(store, bar, 'Zürich', 'secret')).toBeNull();
});
