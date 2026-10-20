import type { Bar } from './data.js';

export type MapEntry = {
  venue: Pick<Bar, 'id' | 'name' | 'lat' | 'lon' | 'address' | 'postcode'>;
  product: string;
  priceChf: number;
  revision: number;
  updatedAt: string;
};
export type CustomMap = { id: string; name: string; createdAt: string; publishedAt?: string;
  publication?: { status: 'pending' | 'approved' | 'rejected'; requestedAt: string; reviewedAt?: string; fingerprint: string };
  entries: MapEntry[] };
export type MapPlace = { venue: Bar; token: string };
export type PublicMap = Pick<CustomMap, 'id' | 'name'> & { venueCount: number };
export const PUBLIC_MAP_MIN_VENUES = 5;
export const mapVenueCount = (map: CustomMap) => new Set(map.entries.map(entry => entry.venue.id)).size;
export function publicMapSummaries(maps: CustomMap[]): PublicMap[] {
  return maps.filter(map => map.publication?.status === 'approved' && Boolean(map.publishedAt)).map(map => ({ id: map.id, name: map.name, venueCount: mapVenueCount(map) }))
    .filter(map => map.venueCount >= PUBLIC_MAP_MIN_VENUES);
}
export const isMapId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
