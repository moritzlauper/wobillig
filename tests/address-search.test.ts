import { afterEach, expect, it, vi } from 'vitest';
import { addressQuery, searchAddresses } from '../src/address-search';

afterEach(() => vi.unstubAllGlobals());
const result = (label: string, lat = 46.94, lon = 7.39) => ({ attrs: { label, lat, lon, origin: 'address' } });

it('normalizes abbreviations, joined addresses, suffix spacing and punctuation for the service', () => {
  expect(addressQuery('  Bümplizstr.97 A, 3018 Bern ')).toBe('bümplizstrasse 97a 3018 bern');
  expect(addressQuery('97a Bümplizstraße')).toBe('97a bümplizstrasse');
  expect(addressQuery('Buemplizstrasse 97 a')).toBe('buemplizstrasse 97a');
  expect(addressQuery('a '.repeat(20)).split(' ')).toHaveLength(10);
});

it('ranks matching addresses before fuzzy results, prefers the current city, validates and deduplicates', async () => {
  const bern = result('Bümplizstrasse 97a <b>3018 Bern</b>');
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [
    result('Andere Strasse 97a'), result('Bümplizstrasse 97a Zürich', 47.37, 8.54), bern, bern,
    result('Invalid', 200), result('Missing', undefined, NaN),
  ] }) });
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  const results = await searchAddresses('Buemplizstr. 97 a', [46.948, 7.447], signal);
  expect(results).toHaveLength(3);
  expect(results[0].label).toBe('Bümplizstrasse 97a 3018 Bern');
  expect(results[1].label).toContain('Zürich');
  expect(fetcher.mock.calls[0][0].searchParams.get('searchText')).toBe('buemplizstrasse 97a');
  expect(fetcher.mock.calls[0][1].signal).toBe(signal);
});

it('distinguishes service failures from empty results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await expect(searchAddresses('Bern', [46.948, 7.447], new AbortController().signal)).rejects.toThrow();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }));
  await expect(searchAddresses('Bern', [46.948, 7.447], new AbortController().signal)).resolves.toEqual([]);
});
