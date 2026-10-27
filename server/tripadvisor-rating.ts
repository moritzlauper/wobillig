import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { distance, type Bar } from '../src/data.js';
import { sameName } from './google-rating.js';

const api = 'https://terra.tripadvisor.com/api';
// The free allowance is granted once per account and never renews. Every billable call counts as one
// unit, and calls are reserved before they are sent, so the account never reaches a paid unit.
export const TRIPADVISOR_LIFETIME_LIMIT = 1000;

export type TripadvisorRating = { source: 'tripadvisor'; rating: number; reviewCount: number; iconUrl: string; url: string };
export type TripadvisorState = { version: 1; used: number; ids: Record<string, number | null> };
export type TripadvisorStore = {
  read(): Promise<{ state: TripadvisorState; etag?: string }>;
  write(state: TripadvisorState, etag?: string): Promise<void>;
};
export class TripadvisorWriteConflict extends Error {}
export const emptyTripadvisorState = (): TripadvisorState => ({ version: 1, used: 0, ids: {} });

type Location = {
  id?: number;
  names?: { value: string; primary?: boolean }[];
  coordinates?: { latitude: number; longitude: number };
  addresses?: { postal_code?: string }[];
  traveler_ratings?: { overall?: { rating?: number; count?: number; icon_url?: string } };
  urls?: { tripadvisor?: { main?: string } };
};

function validState(state: TripadvisorState): boolean {
  return state?.version === 1 && Number.isInteger(state.used) && state.used >= 0
    && Boolean(state.ids) && typeof state.ids === 'object' && !Array.isArray(state.ids);
}

export function tripadvisorStore(): TripadvisorStore {
  // Shared by every deployment: the allowance belongs to the account, so separate counters would multiply it.
  const path = 'tripadvisor-ratings/state.json';
  return {
    async read() {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Rating storage unavailable');
      const result = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      if (!result) return { state: emptyTripadvisorState() };
      if (result.statusCode !== 200) throw new Error('Rating storage unavailable');
      const state = await new Response(result.stream).json() as TripadvisorState;
      if (!validState(state) || !result.blob.etag) throw new Error('Invalid rating storage');
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        await put(path, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false,
          allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (!etag && error instanceof Error && /already exists/i.test(error.message))) throw new TripadvisorWriteConflict();
        throw error;
      }
    },
  };
}

async function update<T>(store: TripadvisorStore, change: (state: TripadvisorState) => { value: T; write: boolean }): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state, etag } = await store.read();
    if (!validState(state)) throw new Error('Invalid rating storage');
    const { value, write } = change(state);
    if (!write) return value;
    try { await store.write(state, etag); return value; }
    catch (error) { if (!(error instanceof TripadvisorWriteConflict)) throw error; }
  }
  throw new Error('Rating storage busy');
}

// Returns false once the lifetime allowance is spent. Failed calls keep their unit: the billing outcome is unknown.
async function reserve(store: TripadvisorStore): Promise<boolean> {
  return update(store, state => {
    if (state.used >= TRIPADVISOR_LIFETIME_LIMIT) return { value: false, write: false };
    state.used++;
    return { value: true, write: true };
  });
}

// Name and coordinates must agree. The postcode must agree when the dataset has one.
function matches(bar: Bar, location: Location): boolean {
  const name = location.names?.find(entry => entry.primary)?.value ?? location.names?.[0]?.value;
  const coordinates = location.coordinates;
  if (!name || !coordinates || !sameName(bar.name, name)) return false;
  if (distance([bar.lat, bar.lon], [coordinates.latitude, coordinates.longitude]) * 1000 > 150) return false;
  return !bar.postcode || Boolean(location.addresses?.some(address => address.postal_code === bar.postcode));
}

async function allowlist(key: string, id: number) {
  const response = await fetch(`${api}/allowlist?version=1`, {
    method: 'POST',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation_type: 'APPEND', allowlist: [id] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Allowlist request failed (${response.status})`);
}

// Location IDs may be stored. Negative results are stored too, so a venue without a match is searched only once.
async function locationId(store: TripadvisorStore, bar: Bar, cityName: string, key: string): Promise<number | null> {
  const cacheKey = `${cityName}:${bar.id}`;
  const { state } = await store.read();
  if (cacheKey in state.ids) return state.ids[cacheKey];
  if (!await reserve(store)) return null;
  const params = new URLSearchParams({
    query: [bar.name, bar.address, bar.postcode].filter(Boolean).join(', '),
    search_type: 'COMBINED', country_code: 'CH', geo_name: cityName, category: 'RESTAURANT', size: '1',
  });
  const response = await fetch(`${api}/catalog/locations/search?${params}`, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = await response.json() as { data?: { location?: Location }[] };
  const location = data.data?.[0]?.location;
  const id = location?.id !== undefined && matches(bar, location) ? location.id : null;
  // The allowlist must contain the ID before its details can be requested. It is free and not billed.
  if (id !== null) await allowlist(key, id);
  await update(store, state => { state.ids[cacheKey] = id; return { value: undefined, write: true }; });
  return id;
}

function ratingFrom(location: Location): TripadvisorRating | null {
  const overall = location.traveler_ratings?.overall;
  const url = location.urls?.tripadvisor?.main;
  if (!overall || typeof overall.rating !== 'number' || !Number.isFinite(overall.rating) || overall.rating < 1 || overall.rating > 5
    || !Number.isInteger(overall.count) || overall.count! < 1 || !overall.icon_url || !url) return null;
  if (new URL(url).protocol !== 'https:' || new URL(overall.icon_url).protocol !== 'https:') return null;
  return { source: 'tripadvisor', rating: overall.rating, reviewCount: overall.count!, iconUrl: overall.icon_url, url };
}

// Ratings are never stored or cached. Each display costs one unit, so the allowance caps the number of displays.
export async function tripadvisorRating(store: TripadvisorStore, bar: Bar, cityName: string, key: string | undefined): Promise<TripadvisorRating | null> {
  if (!key) return null;
  const id = await locationId(store, bar, cityName, key);
  if (id === null) return null;
  if (!await reserve(store)) return null;
  const response = await fetch(`${api}/locations/${id}`, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  return ratingFrom(await response.json() as Location);
}
