import { communityVenues, InputError } from '../src/community.js';
import { isMapId, type CustomMap } from '../src/custom-map-data.js';
import { WriteConflict, type Store } from './prices.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\x00-\x1f]/.test(value);
}

export async function saveCustomMap(store: Store, value: unknown, datasets: Parameters<typeof communityVenues>[0], visitor: string, now = Date.now()): Promise<CustomMap> {
  if (!value || typeof value !== 'object') throw new InputError('Ungültiger Eintrag.');
  const input = value as Record<string, unknown>;
  if (!isMapId(input.mapId)) throw new InputError('Ungültige Map.');
  const create = input.action === 'createMap';
  if (!create && input.action !== 'saveMapEntry') throw new InputError('Ungültiger Eintrag.');
  if (create && !text(input.name, 60)) throw new InputError('Bitte einen Map-Namen mit höchstens 60 Zeichen eingeben.');
  if (!create && (!text(input.product, 100) || typeof input.priceChf !== 'number' || !Number.isFinite(input.priceChf) ||
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
      if (existing.name !== (input.name as string).trim()) throw new InputError('Ungültige Map.', 409);
      return existing;
    }
    if (!create && !existing) throw new InputError('Diese Map wurde nicht gefunden.', 404);
    const map: CustomMap = existing || { id: input.mapId, name: (input.name as string).trim(), createdAt: new Date(now).toISOString(), entries: [] };
    if (!create) {
      const venue = communityVenues(datasets, [], state.venues).find(bar => bar.id === input.barId);
      if (!venue) throw new InputError('Bitte ein Lokal aus der Liste wählen.');
      const previous = map.entries.find(entry => entry.venue.id === venue.id);
      if ((previous?.revision || 0) !== input.revision) throw new InputError('Dieser Preis wurde inzwischen geändert. Bitte schliessen und erneut öffnen.', 409);
      if (!previous && map.entries.length >= 500) throw new InputError('Diese Map enthält bereits 500 Lokale.');
      const { id, name, lat, lon, address, postcode } = venue;
      map.entries = [...map.entries.filter(entry => entry.venue.id !== id), {
        venue: { id, name, lat, lon, address, postcode }, product: (input.product as string).trim(), priceChf: input.priceChf as number,
        revision: (previous?.revision || 0) + 1, updatedAt: new Date(now).toISOString(),
      }];
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
