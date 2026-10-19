import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/data';
import { fetchGoogleRating, matchGoogleRating } from '../server/google-rating';

const bar = (JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset).bars.find(b => b.name === '60 Seconds to Napoli')!;
const place = {
  id: 'place-a', displayName: { text: '60 seconds to napoli Zürich' }, location: { latitude: bar.lat, longitude: bar.lon },
  addressComponents: [{ longText: 'Kasernenstrasse', types: ['route'] }, { longText: '77A', types: ['street_number'] }],
  rating: 4.5, userRatingCount: 123, googleMapsUri: 'https://maps.google.com/?cid=123',
};
afterEach(() => vi.unstubAllGlobals());
it('matches a venue by name, full address and nearby coordinates', () => {
  expect(matchGoogleRating(bar, [place])).toEqual({ rating: 4.5, reviewCount: 123, mapsUrl: place.googleMapsUri, attributions: [] });
});
it('rejects a neighbouring branch, wrong name, distant venue, closed business and ambiguous results', () => {
  expect(matchGoogleRating(bar, [{ ...place, addressComponents: [{ longText: 'Kasernenstrasse', types: ['route'] }, { longText: '77', types: ['street_number'] }] }])).toBeNull();
  expect(matchGoogleRating(bar, [{ ...place, displayName: { text: 'Napoli' } }])).toBeNull();
  expect(matchGoogleRating(bar, [{ ...place, location: { latitude: bar.lat + .01, longitude: bar.lon } }])).toBeNull();
  expect(matchGoogleRating(bar, [{ ...place, businessStatus: 'CLOSED_PERMANENTLY' }])).toBeNull();
  expect(matchGoogleRating(bar, [place, { ...place, id: 'place-b' }])).toBeNull();
});
it('does not manufacture ratings when missing, out of range or without reviews', () => {
  for (const rating of [undefined, 0, 6, NaN, Infinity]) expect(matchGoogleRating(bar, [{ ...place, rating }])).toBeNull();
  expect(matchGoogleRating(bar, [{ ...place, userRatingCount: 0 }])).toBeNull();
  expect(matchGoogleRating(bar, [{ ...place, googleMapsUri: 'https://example.org/' }])).toBeNull();
  expect(matchGoogleRating(bar, [])).toBeNull();
});
it('requires a closer position when the catalogue has no address', () => {
  expect(matchGoogleRating({ ...bar, address: '' }, [place])).not.toBeNull();
  expect(matchGoogleRating({ ...bar, address: '' }, [{ ...place, location: { latitude: bar.lat + .0007, longitude: bar.lon } }])).toBeNull();
});
it('requests only necessary fields and never sends the key in the URL or returns it', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [place] })));
  vi.stubGlobal('fetch', fetch);
  const result = await fetchGoogleRating(bar, 'Zürich', 'private-test-key');
  expect(result?.rating).toBe(4.5);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
  expect(options.headers['X-Goog-Api-Key']).toBe('private-test-key');
  expect(options.headers['X-Goog-FieldMask']).not.toContain('places.reviews');
  expect(JSON.stringify(result)).not.toContain('private-test-key');
});
it('does not expose an upstream error body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret upstream details', { status: 403 })));
  await expect(fetchGoogleRating(bar, 'Zürich', 'key')).rejects.toThrow('Places request failed (403)');
});
