export const cities = {
  zurich: { name: 'Zürich', path: '/', data: '', center: [47.378, 8.535] as [number, number] },
  bern: { name: 'Bern', path: '/bern', data: 'bern/', center: [46.948, 7.447] as [number, number] },
  basel: { name: 'Basel', path: '/basel', data: 'basel/', center: [47.558, 7.589] as [number, number] },
};
export type City = keyof typeof cities;
export function isCity(value: string): value is City { return Object.hasOwn(cities, value); }
export function cityFromPath(path: string, base = '/'): City {
  const relative = path.startsWith(base) ? path.slice(base.length) : path;
  const slug = relative.replace(/^\/+|\/+$/g, '');
  return isCity(slug) ? slug : 'zurich';
}
export function cityLink(city: City, search: string, base = '/'): string {
  const params = new URLSearchParams(search);
  params.delete('bar');
  if (city !== 'zurich') { params.delete('kreise'); params.delete('kreis'); }
  const query = params.toString();
  return base.replace(/\/$/, '') + cities[city].path + (query ? `?${query}` : '');
}
// Preserve the original Zürich store, including all existing contributions.
export function cityStoragePath(city: City, production: boolean): string {
  return `prices/${city === 'zurich' ? '' : `${city}/`}${production ? 'production' : 'development'}.json`;
}
