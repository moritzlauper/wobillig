import { cities, type City } from './cities.js';
import { InputError } from './community.js';
import { distance, type Bar } from './data.js';

export type VenueInput = Pick<Bar, 'name' | 'address' | 'postcode' | 'lat' | 'lon' | 'type' | 'outdoor'> & { website: string };
export const newVenueTypes = { cafe: 'Café', bar: 'Bar', pub: 'Pub', restaurant: 'Restaurant', biergarten: 'Biergarten', fast_food: 'Imbiss' };

export function validateVenue(value: unknown, city: City): VenueInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Ungültiges Lokal.');
  const x = value as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const value = x[key];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) throw new InputError('Bitte Name und Strasse mit Hausnummer vollständig eingeben.');
    return value.trim();
  };
  const name = text('name', 100), address = text('address', 160), postcode = text('postcode', 4);
  if (!/^\d{4}$/.test(postcode)) throw new InputError('Bitte eine vierstellige Postleitzahl eingeben.');
  if (typeof x.lat !== 'number' || typeof x.lon !== 'number' || !Number.isFinite(x.lat) || !Number.isFinite(x.lon)
      || Math.abs(x.lat) > 90 || Math.abs(x.lon) > 180 || distance(cities[city].center, [x.lat, x.lon]) > 15) {
    throw new InputError(`Bitte eine Kartenposition in oder um ${cities[city].name} wählen.`);
  }
  if (typeof x.type !== 'string' || !Object.hasOwn(newVenueTypes, x.type) || typeof x.outdoor !== 'boolean') throw new InputError('Bitte eine gültige Lokalart wählen.');
  if (typeof x.website !== 'string' || x.website.length > 1500) throw new InputError('Ungültige Website.');
  let website = x.website.trim();
  if (website) {
    try {
      const url = new URL(website);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      website = url.href;
    } catch { throw new InputError('Die Website muss mit https:// oder http:// beginnen.'); }
  }
  return { name, address, postcode, lat: x.lat, lon: x.lon, type: x.type, outdoor: x.outdoor, website };
}

const normalized = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function duplicateVenue(input: VenueInput, venues: Bar[]): Bar | undefined {
  return venues.find(b => normalized(b.name) === normalized(input.name) &&
    (distance([b.lat, b.lon], [input.lat, input.lon]) < .1 ||
      (b.postcode === input.postcode && normalized(b.address) === normalized(input.address))));
}
