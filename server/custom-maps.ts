import { communityVenues, InputError } from '../src/community.js';
import { isMapId, mapVenueCount, PUBLIC_MAP_MIN_VENUES, type CustomMap } from '../src/custom-map-data.js';
import type { City } from '../src/cities.js';
import { verifiedMapPlace } from './map-places.js';
import { createHash } from 'node:crypto';
import { WriteConflict, type Store } from './prices.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\x00-\x1f]/.test(value);
}
export const mapFingerprint = (map: CustomMap) => createHash('sha256').update(JSON.stringify({ name: map.name, entries: map.entries })).digest('hex');

// Suggestions are stored for review only. Never fetch a visitor-supplied URL.
export function automaticMapInput(input: Record<string, unknown>) {
  const description = typeof input.description === 'string' ? input.description.replace(/\r\n?/g, '\n').trim() : '';
  if (!text(description.replace(/\n/g, ' '), 600)) throw new InputError('Bitte beschreiben, welche Angebote die Map zeigen soll (höchstens 600 Zeichen).');
  try {
    if (!text(input.sourceUrl, 2000)) throw new Error();
    const url = new URL((input.sourceUrl as string).trim());
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    url.hash = '';
    return { sourceUrl: url.href, description };
  } catch { throw new InputError('Bitte einen gültigen HTTPS-Link zur Angebotsseite eingeben.'); }
}
export function duplicateAutomaticMap(maps: CustomMap[], suggestion: { sourceUrl: string; description: string }) {
  const normalize = (value: string) => value.toLocaleLowerCase('de-CH').replace(/\s+/g, ' ').trim();
  return maps.find(map => map.automatic && map.automatic.status !== 'rejected' &&
    map.automatic.sourceUrl === suggestion.sourceUrl && normalize(map.automatic.description) === normalize(suggestion.description));
}

export async function saveCustomMap(store: Store, value: unknown, datasets: Parameters<typeof communityVenues>[0], visitor: string, now = Date.now(), city: City = 'zurich'): Promise<CustomMap> {
  if (!value || typeof value !== 'object') throw new InputError('Ungültiger Eintrag.');
  const input = value as Record<string, unknown>;
  if (!isMapId(input.mapId)) throw new InputError('Ungültige Map.');
  const automatic = input.action === 'requestAutomaticMap';
  const create = input.action === 'createMap' || automatic;
  const visibility = input.action === 'requestMapPublication' || input.action === 'withdrawMapPublication';
  if (!create && !visibility && input.action !== 'saveMapEntry') throw new InputError('Ungültiger Eintrag.');
  if (create && !text(input.name, 60)) throw new InputError('Bitte einen Map-Namen mit höchstens 60 Zeichen eingeben.');
  const suggestion = automatic ? automaticMapInput(input) : undefined;
  if (!create && !visibility && (!text(input.product, 100) || typeof input.priceChf !== 'number' || !Number.isFinite(input.priceChf) ||
    input.priceChf < 0.5 || input.priceChf > 500 || Math.abs(input.priceChf * 100 - Math.round(input.priceChf * 100)) > .00001 ||
    !Number.isSafeInteger(input.revision) || (input.revision as number) < 0)) {
    throw new InputError('Bitte Produkt und Preis zwischen CHF 0.50 und CHF 500 eingeben (maximal zwei Nachkommastellen).');
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const maps = state.customMaps || [];
    const existing = maps.find(map => map.id === input.mapId);
    // The client keeps the creation ID during retries after a lost response.
    if (create && existing) {
      if (existing.name !== (input.name as string).trim() || Boolean(existing.automatic) !== automatic ||
        (suggestion && (existing.automatic?.sourceUrl !== suggestion.sourceUrl || existing.automatic?.description !== suggestion.description))) throw new InputError('Ungültige Map.', 409);
      return existing;
    }
    if (suggestion) {
      const duplicate = duplicateAutomaticMap(maps, suggestion);
      if (duplicate) return duplicate;
    }
    if (!create && !existing) throw new InputError('Diese Map wurde nicht gefunden.', 404);
    if (!create && existing?.automatic) throw new InputError('Diese automatische Map wird vom Team geprüft. Manuelle Änderungen sind nicht möglich.', 409);
    const map: CustomMap = existing || { id: input.mapId, name: (input.name as string).trim(), createdAt: new Date(now).toISOString(), entries: [] };
    if (suggestion) map.automatic = { ...suggestion, status: 'requested', revision: 1 };
    if (visibility) {
      if (input.action === 'requestMapPublication') {
        if (mapVenueCount(map) < PUBLIC_MAP_MIN_VENUES) throw new InputError('Zum Veröffentlichen bitte mindestens einen Ort mit Preis eintragen.', 422);
        if (map.publication?.status === 'pending' || map.publication?.status === 'approved') return map;
        const fingerprint = mapFingerprint(map);
        if (map.publication?.status === 'rejected' && map.publication.fingerprint === fingerprint) throw new InputError('Bitte die Map vor einer erneuten Einreichung überarbeiten.', 422);
        map.publication = { status: 'pending', requestedAt: new Date(now).toISOString(), fingerprint };
      } else delete map.publication;
      delete map.publishedAt;
    } else if (!create) {
      const venue = communityVenues(datasets, [], state.venues, state.venueCorrections).find(bar => bar.id === input.barId)
        || map.entries.find(entry => entry.venue.id === input.barId)?.venue
        || (input.placeToken ? verifiedMapPlace(input.placeToken, city, input.barId, now) : undefined);
      if (!venue) throw new InputError('Bitte ein Lokal aus der Liste wählen.');
      const previous = map.entries.find(entry => entry.venue.id === venue.id);
      if ((previous?.revision || 0) !== input.revision) throw new InputError('Dieser Preis wurde inzwischen geändert. Bitte schliessen und erneut öffnen.', 409);
      if (!previous && map.entries.length >= 500) throw new InputError('Diese Map enthält bereits 500 Lokale.');
      const { id, name, lat, lon, address, postcode } = venue;
      map.entries = [...map.entries.filter(entry => entry.venue.id !== id), {
        venue: { id, name, lat, lon, address, postcode }, product: (input.product as string).trim(), priceChf: input.priceChf as number,
        revision: (previous?.revision || 0) + 1, updatedAt: new Date(now).toISOString(),
      }];
      // Changed contents must never bypass the review of the submitted version.
      if (map.publication && map.publication.status !== 'rejected') {
        delete map.publication;
        delete map.publishedAt;
      }
    }
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, limit]) => limit.expires > now));
    const key = `${create ? 'create-map' : 'map-entry'}:${visitor}`;
    const limit = state.limits[key] || { count: 0, expires: now + 3600000 };
    if (limit.count >= (create ? 5 : 30)) throw new InputError('Zu viele Einträge. Bitte in einer Stunde erneut versuchen.', 429);
    state.limits[key] = { ...limit, count: limit.count + 1 };
    state.customMaps = [...maps.filter(other => other.id !== map.id), map];
    try { await store.write(state, etag); return map; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Die Map wird gerade geändert. Bitte erneut versuchen.', 409);
}
