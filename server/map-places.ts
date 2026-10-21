import { createHmac, timingSafeEqual } from 'node:crypto';
import { cities, type City } from '../src/cities.js';
import { InputError } from '../src/community.js';
import { distance, type Bar } from '../src/data.js';
import type { MapEntry, MapPlace } from '../src/custom-map-data.js';

const cache = new Map<string, { at: number; result: Promise<Bar[]> }>();
const viewportCache = new Map<string, { at: number; result: Promise<Bar[]> }>();
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : '';
const signature = (payload: string) => {
  const secret = process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret) throw new Error('Missing storage secret');
  return createHmac('sha256', secret).update(`map-place:${payload}`).digest();
};

// Bind a provider result to its city and OSM identity; client-submitted coordinates
// never become canonical simply because a user pasted an OSM ID.
export function signMapPlace(venue: Bar, city: City, now = Date.now()): MapPlace {
  const { id, name, lat, lon, address, postcode } = venue;
  const payload = Buffer.from(JSON.stringify({ city, venue: { id, name, lat, lon, address, postcode }, expires: now + 86400000 })).toString('base64url');
  return { venue, token: `${payload}.${signature(payload).toString('base64url')}` };
}
export function verifiedMapPlace(token: unknown, city: City, id: unknown, now = Date.now()): MapEntry['venue'] {
  const invalid = () => new InputError('Bitte den Ort erneut suchen und aus den Vorschlägen auswählen.', 422);
  if (typeof token !== 'string' || token.length > 4000) throw invalid();
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra !== undefined) throw invalid();
  const actual = Buffer.from(mac, 'base64url'), expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.city !== city || !Number.isFinite(data.expires) || data.expires <= now || data.venue?.id !== id) throw invalid();
    return data.venue;
  } catch { throw invalid(); }
}

export async function searchMapPlaces(query: string, city: City, now = Date.now()): Promise<MapPlace[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  if (text.length > 160 || /[\x00-\x1f\x7f]/.test(text)) throw new InputError('Bitte eine kürzere Suche eingeben.');
  const key = `${city}:${text.toLocaleLowerCase('de-CH')}`;
  for (const [key, entry] of cache) if (entry.at + 300000 < now) cache.delete(key);
  let cached = cache.get(key);
  if (!cached) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    const result = (async () => {
      const [lat, lon] = cities[city].center;
      const radiusLat = 15 / 111, radiusLon = radiusLat / Math.cos(lat * Math.PI / 180);
      // No category/tag filter: shops, pharmacies, amenities and other indexed
      // OSM places are all eligible for a custom map in this city and its vicinity.
      const url = new URL(process.env.PHOTON_URL || 'https://photon.komoot.io/api/');
      url.search = new URLSearchParams({ q: text, lat: String(lat), lon: String(lon), limit: '20', lang: 'de', dedupe: '0',
        bbox: [lon - radiusLon, lat - radiusLat, lon + radiusLon, lat + radiusLat].join(',') }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'wobillig.ch custom map place search', Accept: 'application/json' } });
      if (!response.ok) throw new Error('OSM search unavailable');
      const body = await response.json();
      if (!Array.isArray(body.features)) throw new Error('Invalid OSM search results');
      const venues = new Map<string, Bar>();
      for (const feature of body.features) {
        const p = feature?.properties, coordinates = feature?.geometry?.coordinates;
        if (!p || feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) continue;
        const [lng, latitude] = coordinates;
        const type = ({ N: 'node', W: 'way', R: 'relation' } as Record<string, string>)[p.osm_type];
        if (!type || !Number.isSafeInteger(p.osm_id) || p.osm_id <= 0 || !Number.isFinite(latitude) || !Number.isFinite(lng)
          || Math.abs(latitude) > 90 || Math.abs(lng) > 180 || distance([lat, lon], [latitude, lng]) > 15) continue;
        const address = [clean(p.street, 120), clean(p.housenumber, 20)].filter(Boolean).join(' ');
        const name = clean(p.name, 100) || address;
        if (!name) continue;
        const id = `${type}/${p.osm_id}`;
        venues.set(id, { id, name, address, postcode: clean(p.postcode, 12), lat: latitude, lon: lng,
          type: clean(p.osm_value, 60) || 'place', offers: [], website: null, openingHours: null, outdoor: false,
          checkedAt: null, scrapeStatus: 'osm' });
      }
      return [...venues.values()];
    })();
    cached = { at: now, result }; cache.set(key, cached);
    result.catch(() => { if (cache.get(key)?.result === result) cache.delete(key); });
  }
  try { return (await cached.result).map(venue => signMapPlace(venue, city, now)); }
  catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('OpenStreetMap-Suche gerade nicht verfügbar. Bitte erneut versuchen oder einen bekannten Ort wählen.', 503);
  }
}

// A small, rounded viewport keeps Overpass queries bounded and reusable while
// panning. Coordinates use Overpass's south, west, north, east order.
export async function mapPlacesInBounds(bounds: string, city: City, now = Date.now()): Promise<MapPlace[]> {
  const parts = bounds.split(',');
  const [south, west, north, east] = parts.map(Number);
  if (parts.length !== 4 || parts.some(part => !part.trim()) || ![south, west, north, east].every(Number.isFinite)
    || south < -90 || north > 90 || west < -180 || east > 180
    || south >= north || west >= east || north - south > 0.04 || east - west > 0.06
    || distance(cities[city].center, [(south + north) / 2, (west + east) / 2]) > 15) {
    throw new InputError('Bitte näher an die Stadt heranzoomen.');
  }
  const rounded = [Math.floor(south * 200) / 200, Math.floor(west * 200) / 200,
    Math.ceil(north * 200) / 200, Math.ceil(east * 200) / 200];
  const key = `${city}:${rounded.join(',')}`;
  for (const [key, entry] of viewportCache) if (entry.at + 300000 < now) viewportCache.delete(key);
  let cached = viewportCache.get(key);
  if (!cached) {
    if (viewportCache.size >= 100) viewportCache.delete(viewportCache.keys().next().value!);
    const result = (async () => {
      const query = `[out:json][timeout:12];nwr[~"^(shop|amenity|craft|office|tourism|leisure|healthcare)$"~"."][name](${rounded.join(',')});out center;`;
      const url = new URL('https://overpass.osm.ch/api/interpreter');
      url.searchParams.set('data', query);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'wobillig.ch custom map places', Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('OSM places unavailable');
      const body = await response.json();
      if (!Array.isArray(body.elements) || body.remark) throw new Error('Incomplete OSM places');
      const venues = new Map<string, Bar>();
      for (const element of body.elements) {
        const tags = element?.tags, lat = element?.lat ?? element?.center?.lat, lon = element?.lon ?? element?.center?.lon;
        const name = clean(tags?.name, 100);
        if (!name || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0
          || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < rounded[0] || lat > rounded[2] || lon < rounded[1] || lon > rounded[3]
          || distance(cities[city].center, [lat, lon]) > 15) continue;
        const id = `${element.type}/${element.id}`;
        venues.set(id, { id, name, lat, lon,
          address: [clean(tags['addr:street'], 120), clean(tags['addr:housenumber'], 20)].filter(Boolean).join(' '),
          postcode: clean(tags['addr:postcode'], 12),
          type: clean(tags.shop || tags.amenity || tags.craft || tags.office || tags.tourism || tags.leisure || tags.healthcare, 60) || 'place',
          offers: [], website: null, openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'osm' });
      }
      return [...venues.values()];
    })();
    cached = { at: now, result }; viewportCache.set(key, cached);
    result.catch(() => { if (viewportCache.get(key)?.result === result) viewportCache.delete(key); });
  }
  try { return (await cached.result).map(venue => signMapPlace(venue, city, now)); }
  catch { throw new InputError('OpenStreetMap-Orte konnten nicht geladen werden. Bitte erneut versuchen.', 503); }
}
