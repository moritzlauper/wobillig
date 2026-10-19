import { afterEach, expect, it, vi } from 'vitest';
import { createSearchHistory } from '../src/search-history';
import type { AddressResult } from '../src/address-search';

const address = (n: number): AddressResult => ({ kind: 'address', label: `Teststrasse ${n}`, lat: 46.9, lon: 7.4, origin: 'address' });
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}
afterEach(() => vi.unstubAllGlobals());

it('persists the eight latest distinct selections per city and clears them', () => {
  storage();
  const history = createSearchHistory('bern');
  for (let n = 0; n < 10; n++) history.remember(address(n));
  history.remember(address(5));
  expect(createSearchHistory('bern').results([])).toEqual([5, 9, 8, 7, 6, 4, 3, 2].map(address));
  expect(createSearchHistory('zurich').results([])).toEqual([]);
  history.clear();
  expect(createSearchHistory('bern').results([])).toEqual([]);
});

it('ignores malformed storage and invalid coordinates', () => {
  storage();
  localStorage.setItem('wobillig-search-history:bern', '{broken');
  expect(createSearchHistory('bern').results([])).toEqual([]);
  localStorage.setItem('wobillig-search-history:bern', JSON.stringify([null, {}, { ...address(1), lat: 100 }, address(2)]));
  expect(createSearchHistory('bern').results([])).toEqual([address(2)]);
});

it('keeps search history usable when storage is blocked', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  });
  const history = createSearchHistory('bern');
  history.remember(address(1));
  expect(history.results([])).toEqual([address(1)]);
  history.clear();
  expect(history.results([])).toEqual([]);
});
