import { localizedPath, type Locale } from './i18n.js';

// districts: URL parameters for showing the official boundaries and for the
// selected official number in data/<city>/districts.json. Most cities use 1 to
// count; Lausanne keeps the official number 90 for its Zones foraines.
export const cities = {
  zurich: { name: 'Zürich', path: '/', data: '', center: [47.378, 8.535] as [number, number], districts: { toggle: 'kreise', param: 'kreis', count: 12 } },
  bern: { name: 'Bern', path: '/bern', data: 'bern/', center: [46.948, 7.447] as [number, number], districts: { toggle: 'stadtteile', param: 'stadtteil', count: 6 } },
  basel: { name: 'Basel', path: '/basel', data: 'basel/', center: [47.558, 7.589] as [number, number], districts: { toggle: 'quartiere', param: 'quartier', count: 19 } },
  lausanne: { name: 'Lausanne', path: '/lausanne', data: 'lausanne/', center: [46.5197, 6.6323] as [number, number], districts: { toggle: 'quartiers', param: 'quartierLausanne', count: 18, numbers: [...Array.from({ length: 17 }, (_, i) => i + 1), 90] } },
  geneva: { name: 'Genf', path: '/geneve', data: 'geneva/', center: [46.2044, 6.1432] as [number, number], districts: { toggle: 'quartiersGeneve', param: 'quartierGeneve', count: 8 } },
  winterthur: { name: 'Winterthur', path: '/winterthur', data: 'winterthur/', center: [47.4995, 8.7275] as [number, number], districts: { toggle: 'stadtkreise', param: 'stadtkreis', count: 7 } },
};
export type City = keyof typeof cities;
export function isCity(value: string): value is City { return Object.hasOwn(cities, value); }
export function cityFromPath(path: string, base = '/'): City {
  const relative = path.startsWith(base) ? path.slice(base.length) : path;
  const slug = relative.replace(/^\/+|\/+$/g, '').replace(/^(?:en|de)(?:\/|$)/, '');
  return slug === 'geneve' || slug === 'genf' ? 'geneva' : isCity(slug) ? slug : 'zurich';
}
// French-speaking cities default to English; leaving them returns to the German default.
export function defaultCityLocale(city: City, current: Locale, from: City = city): Locale {
  if (city === 'lausanne' || city === 'geneva') return 'en';
  return from === 'lausanne' || from === 'geneva' ? 'de' : current;
}
export function cityLink(city: City, search: string, base = '/', locale: Locale = 'de'): string {
  const params = new URLSearchParams(search);
  params.delete('bar');
  // District numbers only exist within their own city's boundaries.
  for (const [id, other] of Object.entries(cities)) if (id !== city) { params.delete(other.districts.toggle); params.delete(other.districts.param); }
  const query = params.toString();
  return base.replace(/\/$/, '') + localizedPath(cities[city].path, locale) + (query ? `?${query}` : '');
}
// Preserve the original Zürich store, including all existing contributions.
export function cityStoragePath(city: City, production: boolean): string {
  return `prices/${city === 'zurich' ? '' : `${city}/`}${production ? 'production' : 'development'}.json`;
}
