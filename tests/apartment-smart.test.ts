import { describe, expect, it } from 'vitest';
import { applyApartmentQuery, queryFromClaude } from '../src/apartment-smart';
import { parseApartmentRules } from '../src/apartment-rules';
import { emptyApartmentFilter } from '../src/apartment-data';

describe('apartment smart search rules', () => {
  it('reads rooms, rent, features, Kreis and duration', () => {
    const query = parseApartmentRules('3zimmer wohnung bis 3000 mit balkon in kreis 3 unbefristet oderso');
    expect(query).toMatchObject({ zimmerMin: 3, zimmerMax: 3.5, mieteMax: 3000, merkmale: ['balkon'], kreise: [3], dauer: 'unbefristet', guenstig: false, rest: [] });
  });
  it('reads half rooms, quarters and thousands', () => {
    expect(parseApartmentRules('2½-Zimmer im Seefeld max 2.5k, hell')).toMatchObject({ zimmerMin: 2.5, zimmerMax: 2.5, kreise: [8], mieteMax: 2500, rest: ['hell'] });
  });
  it('reads kinds, several Kreise and Franken', () => {
    expect(parseApartmentRules('WG-Zimmer unter 900 Franken Kreis 4 und 5')).toMatchObject({ arten: ['wg'], mieteMax: 900, kreise: [4, 5], rest: [] });
  });
  it('keeps area apart from rent and looks up streets literally', () => {
    expect(parseApartmentRules('ab 60 m2 mit Lift und Haustiere, befristet')).toMatchObject({ flaecheMin: 60, mieteMax: null, merkmale: ['lift', 'haustiere'], dauer: 'befristet' });
    expect(parseApartmentRules('Wohnung an der Langstrasse 8004').text).toBe('8004 langstrasse');
  });
  it('starts unnamed fields over but keeps sources and drawn areas', () => {
    const current = { ...emptyApartmentFilter(), merkmale: ['lift' as const], quellenAus: ['ronorp' as const], gebiete: [{ punkte: [[8.5, 47.3], [8.6, 47.3], [8.6, 47.4]] as [number, number][] }] };
    const { rest: _rest, ...query } = parseApartmentRules('2 Zimmer bis 2000');
    const next = applyApartmentQuery(current, query);
    expect(next).toMatchObject({ zimmerMin: 2, mieteMax: 2000, merkmale: [], quellenAus: ['ronorp'] });
    expect(next.gebiete).toHaveLength(1);
  });
  it('keeps permanent listings as the default duration', () => {
    expect(parseApartmentRules('2 Zimmer bis 2000').dauer).toBe('unbefristet');
    expect(parseApartmentRules('2 Zimmer, auch befristet').dauer).toBe('alle');
    expect(parseApartmentRules('Zwischenmiete im Kreis 4').dauer).toBe('befristet');
  });
  it('accepts only known values from Claude', () => {
    expect(queryFromClaude({ zimmerMin: 3, zimmerMax: 3.5, mieteMax: 0, flaecheMin: 0, arten: ['villa'], kreise: [3, 15], merkmale: ['balkon', 'pool'], dauer: 'ewig', nurNeu: false, guenstig: true, sorte: 'keine', stichwort: '', begriffe: ['Altbau', 'hell'] }))
      .toEqual({ zimmerMin: 3, zimmerMax: 3.5, mieteMax: null, flaecheMin: null, arten: emptyApartmentFilter().arten, kreise: [3], merkmale: ['balkon'], dauer: 'unbefristet', nurNeu: false, guenstig: true, text: '', begriffe: ['altbau', 'hell'] });
    expect(queryFromClaude('nope')).toBeUndefined();
  });
});
