import { normalizeSearch } from './search';

export interface AddressResult {
  kind: 'address';
  label: string;
  lat: number;
  lon: number;
  origin: string;
}

export function addressQuery(query: string): string {
  return query.toLocaleLowerCase('de-CH').replace(/ß/g, 'ss')
    .replace(/str\b\.?/g, 'strasse')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)\s+([a-z])\b/g, '$1$2')
    .replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 10).join(' ');
}

// Public Swiss address directory; no API key required.
// https://docs.geo.admin.ch/access-data/search.html
export async function searchAddresses(query: string, center: [number, number], signal: AbortSignal, locality = ''): Promise<AddressResult[]> {
  const text = addressQuery(query);
  if (text.length < 2) return [];
  const queries = [text];
  // Common street names can fill the national result limit before this city
  // appears. Include a local query without restricting explicit other places.
  if (locality && !normalizeSearch(text).includes(normalizeSearch(locality))) queries.push(addressQuery(`${text} ${locality}`));
  const responses = await Promise.allSettled(queries.map(async searchText => {
    const url = new URL('https://api3.geo.admin.ch/rest/services/ech/SearchServer');
    url.search = new URLSearchParams({ searchText, type: 'locations', origins: 'address,zipcode,gg25', limit: '50', sr: '4326' }).toString();
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Address search unavailable');
    const body = await response.json();
    if (!Array.isArray(body.results)) throw new Error('Invalid address results');
    return body.results;
  }));
  const successful = responses.filter(response => response.status === 'fulfilled');
  if (!successful.length) throw new Error('Address search unavailable');
  const results: AddressResult[] = [];
  const seen = new Set<string>();
  for (const result of successful.flatMap(response => response.value)) {
    const attrs = result?.attrs;
    if (!attrs || typeof attrs.label !== 'string' || !Number.isFinite(attrs.lat) || !Number.isFinite(attrs.lon)
      || Math.abs(attrs.lat) > 90 || Math.abs(attrs.lon) > 180) continue;
    const label = attrs.label.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
    const key = `${label}:${attrs.lat}:${attrs.lon}`;
    if (!label || seen.has(key)) continue;
    seen.add(key);
    results.push({ kind: 'address', label, lat: attrs.lat, lon: attrs.lon, origin: attrs.origin });
  }
  const words = normalizeSearch(text).split(/\s+/);
  const score = (r: AddressResult) => words.filter(word => normalizeSearch(r.label).includes(word)).length;
  const distance = (r: AddressResult) => (r.lat - center[0]) ** 2 + ((r.lon - center[1]) * Math.cos(center[0] * Math.PI / 180)) ** 2;
  return results.sort((a, b) => score(b) - score(a)
    || Number(a.origin === 'address') - Number(b.origin === 'address')
    || distance(a) - distance(b)).slice(0, 6);
}
