import { localizedPath, type Locale } from './i18n.js';

export const cities = {
  zurich: { name: 'Zürich', path: '/', data: '', center: [47.378, 8.535] as [number, number] },
  bern: { name: 'Bern', path: '/bern', data: 'bern/', center: [46.948, 7.447] as [number, number] },
  basel: { name: 'Basel', path: '/basel', data: 'basel/', center: [47.558, 7.589] as [number, number] },
  lausanne: { name: 'Lausanne', path: '/lausanne', data: 'lausanne/', center: [46.5197, 6.6323] as [number, number] },
  geneva: { name: 'Genf', path: '/geneve', data: 'geneva/', center: [46.2044, 6.1432] as [number, number] },
  winterthur: { name: 'Winterthur', path: '/winterthur', data: 'winterthur/', center: [47.4995, 8.7275] as [number, number] },
  olten: { name: 'Olten', path: '/olten', data: 'olten/', center: [47.3531, 7.9078] as [number, number] },
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
  const query = params.toString();
  return base.replace(/\/$/, '') + localizedPath(cities[city].path, locale) + (query ? `?${query}` : '');
}
// Preserve the original Zürich store, including all existing contributions.
export function cityStoragePath(city: City, production: boolean): string {
  return `prices/${city === 'zurich' ? '' : `${city}/`}${production ? 'production' : 'development'}.json`;
}
