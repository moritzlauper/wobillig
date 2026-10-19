import type { Bar } from './data.js';

export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase('de-CH').normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/str\b\.?/g, 'strasse').replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)\s+([a-z])\b/g, '$1$2').trim();
}

export function matchesSearch(bar: Pick<Bar, 'name' | 'address' | 'postcode'>, query: string): boolean {
  const text = normalizeSearch(`${bar.name} ${bar.address} ${bar.postcode}`);
  return normalizeSearch(query).split(/\s+/).every(word => /^\d/.test(word)
    ? text.split(/\s+/).some(token => token === word || (/^\d+$/.test(word) && new RegExp(`^${word}[a-z]$`).test(token)))
    : text.includes(word));
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
