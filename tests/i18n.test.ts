import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { cities } from '../src/cities';
import { beerTypeLabels, coffeeLabels } from '../src/data';
import { translate } from '../src/i18n';
import { en } from '../src/i18n-en';

const sources = ['src', 'server', 'api', 'build'].flatMap(dir => readdirSync(dir).filter(file => file.endsWith('.ts')).map(file => `${dir}/${file}`));
// Literal texts passed to t()/translate()/tr() and error messages that reach the browser.
const literal = /(?:\bt\(|\btr\(|\btranslate\(\w+, |InputError\(|error: )'((?:[^'\\]|\\.)*)'/g;

it('has an English text for every German UI text and error message', () => {
  const missing = sources.flatMap(file => [...readFileSync(file, 'utf8').matchAll(literal)]
    .map(match => match[1].replace(/\\'/g, "'"))
    .filter(text => !Object.hasOwn(en, text))
    .map(text => `${file}: ${text}`));
  expect(missing).toEqual([]);
  for (const city of Object.values(cities)) expect(en).toHaveProperty([`Bitte eine Kartenposition in oder um ${city.name} wählen.`]);
});

it('keeps the same placeholders in both languages', () => {
  for (const [german, english] of Object.entries(en)) {
    expect(english.match(/\{\w+\}/g)?.sort(), german).toEqual(german.match(/\{\w+\}/g)?.sort());
  }
});

it('falls back to German and fills in placeholders', () => {
  expect(translate('de', 'Schnitt {city} {value}', { city: 'Bern', value: '—' })).toBe('Schnitt Bern —');
  expect(translate('en', 'Schnitt {city} {value}', { city: 'Bern', value: 'CHF 4.50' })).toBe('Bern average CHF 4.50');
  expect(translate('en', 'Kaffeepreise {city}', { city: translate('en', cities.zurich.name) })).toBe('Coffee prices in Zurich');
  expect(translate('en', 'Noch nicht übersetzt')).toBe('Noch nicht übersetzt');
  expect(Object.values(beerTypeLabels).map(label => translate('en', label))).toEqual(['Draught beer', 'Bottled beer', 'Canned beer', 'Serving unknown']);
  expect(translate('en', coffeeLabels.milk)).toBe('Milk coffee');
});
