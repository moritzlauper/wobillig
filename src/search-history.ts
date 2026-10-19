import type { AddressResult } from './address-search';
import type { Bar } from './data';

type SearchHistoryEntry = AddressResult | { kind: 'venue'; id: string };
const limit = 8;

function validEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (entry.kind === 'venue') return typeof entry.id === 'string' && !!entry.id;
  return entry.kind === 'address' && typeof entry.label === 'string' && !!entry.label.trim()
    && typeof entry.origin === 'string'
    && typeof entry.lat === 'number' && Number.isFinite(entry.lat) && Math.abs(entry.lat) <= 90
    && typeof entry.lon === 'number' && Number.isFinite(entry.lon) && Math.abs(entry.lon) <= 180;
}

const key = (entry: SearchHistoryEntry) => entry.kind === 'venue'
  ? `venue:${entry.id}` : `address:${entry.label}:${entry.lat}:${entry.lon}`;

export function createSearchHistory(city: string) {
  const storageKey = `wobillig-search-history:${city}`;
  let entries: SearchHistoryEntry[] = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored)) entries = stored.filter(validEntry).slice(0, limit);
  } catch { /* Search still works when browser storage is unavailable. */ }

  return {
    results(venues: Bar[]): (Bar | AddressResult)[] {
      return entries.flatMap((entry): (Bar | AddressResult)[] => {
        if (entry.kind === 'address') return [entry];
        const venue = venues.find(bar => bar.id === entry.id);
        return venue ? [venue] : [];
      });
    },
    remember(result: Bar | AddressResult) {
      const entry: SearchHistoryEntry = 'kind' in result ? result : { kind: 'venue', id: result.id };
      entries = [entry, ...entries.filter(previous => key(previous) !== key(entry))].slice(0, limit);
      try { localStorage.setItem(storageKey, JSON.stringify(entries)); } catch { /* Keep an in-memory history. */ }
    },
    clear() {
      entries = [];
      try { localStorage.removeItem(storageKey); } catch { /* Keep the in-memory history cleared. */ }
    },
  };
}
