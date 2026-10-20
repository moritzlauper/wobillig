import type { Bar } from './data.js';

export type MapEntry = {
  venue: Pick<Bar, 'id' | 'name' | 'lat' | 'lon' | 'address' | 'postcode'>;
  product: string;
  priceChf: number;
  revision: number;
  updatedAt: string;
};
export type CustomMap = { id: string; name: string; createdAt: string; entries: MapEntry[] };
export const isMapId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
