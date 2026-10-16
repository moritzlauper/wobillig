import type { Bar } from './data.js';

export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase('de-CH').normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function matchesSearch(bar: Pick<Bar, 'name' | 'address' | 'postcode'>, query: string): boolean {
  const text = normalizeSearch(`${bar.name} ${bar.address} ${bar.postcode}`);
  return normalizeSearch(query).split(/\s+/).every(word => text.includes(word));
}

export function searchSuggestions(bars: Bar[], query: string, limit = 6): Bar[] {
  const term = normalizeSearch(query);
  if (!term) return [];
  const rank = (bar: Bar) => {
    const name = normalizeSearch(bar.name);
    return name === term ? 0 : name.startsWith(term) ? 1 : name.includes(term) ? 2 : 3;
  };
  return bars.filter(bar => matchesSearch(bar, query))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de') || a.address.localeCompare(b.address, 'de'))
    .slice(0, limit);
}
