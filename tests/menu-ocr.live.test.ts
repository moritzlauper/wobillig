import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readMenu, menuPrices, OCR_BUDGET_USD } from '../server/menu-ocr';
import type { Bar } from '../src/data';

const enabled = process.env.RUN_MENU_OCR_LIVE === '1';
const venue = (name: string) => ({ id: 'node/test', name, address: '', postcode: '', offers: [] } as unknown as Bar);
const reports: unknown[] = [];
it.skipIf(!enabled || !process.env.OCR_VICAFE_PHOTO)('reads the complete ViCAFE phone photo without asking for a crop', async () => {
  const { result, bar } = await scan(process.env.OCR_VICAFE_PHOTO!, 'ViCAFE Campus Rondell (UZH Hauptgebäude)');
  const { prices } = menuPrices(result.parsed, bar, '2026-10-21');
  expect(prices.map(p => [p.input.coffeeType, p.input.priceChf])).toEqual(expect.arrayContaining([
    ['espresso', 3.6], ['double', 4], ['americano', 4.5], ['flat_white', 5.3], ['matcha_latte', 5.3],
  ]));
  expect(prices.every(p => p.input.drink === 'coffee')).toBe(true);
  expect(prices.some(p => /iced|chai|chocolate|extra shot/i.test(p.input.name))).toBe(false);
  expect(prices.some(p => [4.8, 5.8].includes(p.input.priceChf))).toBe(false);
}, 180000);
async function scan(path: string, name: string) {
  const bar = venue(name), started = Date.now();
  const result = await readMenu({ data: readFileSync(path).toString('base64'), mediaType: 'image/jpeg' }, bar, process.env.ANTHROPIC_API_KEY!);
  reports.push({ path, name, milliseconds: Date.now() - started, raw: result.parsed, verification: result.verification, usage: result.usage });
  writeFileSync('/tmp/wobillig-ocr-live-results.json', JSON.stringify(reports, null, 2));
  expect(result.usage.costUsd).toBeLessThanOrEqual(OCR_BUDGET_USD);
  return { result, bar };
}
describe.each(Array.from({ length: Number(process.env.OCR_LIVE_REPEATS || 1) }, (_, i) => i + 1))('live run %i', () => {
it.skipIf(!enabled)('reads the real 169 West photo without reverse-side text, food, tea or supplements', async () => {
  const { result, bar } = await scan('scraper/photo_inputs/169-west-2026-09.jpg', '169 West');
  const parsed = menuPrices(result.parsed, bar, '2026-10-16');
  expect(parsed.prices.map(p => [p.input.coffeeType, p.input.priceChf])).toEqual(expect.arrayContaining([
    ['espresso', 5], ['double', 6], ['americano', 6], ['cappuccino', 6.5], ['flat_white', 7],
  ]));
  expect(parsed.prices).toHaveLength(10);
  expect(parsed.prices.filter(p => p.input.coffeeType === 'filter').map(p => p.input.priceChf).sort()).toEqual([6, 6, 6, 7, 8]);
  expect(parsed.prices.every(p => p.input.drink === 'coffee')).toBe(true);
}, 90000);
it.skipIf(!enabled)('reads all ten prices in a recreated Marsbar table with correct columns', async () => {
  const { result, bar } = await scan('tests/fixtures/menu-scan-table.jpg', 'Mars Bar');
  const { prices } = menuPrices(result.parsed, bar, '2026-10-16');
  expect(prices).toHaveLength(10);
  for (const [name, small, large] of [['Sprint', 5.2, 7.9], ['Rekord', 5.5, 8], ['Bohém', 5.7, 8.7], ['IPAnema', 7.5, 11.5], ['Brausyndikat', 5.7, 8.7]] as const) {
    expect(prices.filter(p => p.input.name.includes(name)).map(p => [p.input.volumeMl, p.input.priceChf, p.input.beerType])).toEqual([[300, small, 'draft'], [500, large, 'draft']]);
  }
}, 90000);
it.skipIf(!enabled)('distinguishes packaging, alcohol-free, coffee and normal pizza; ignores image instructions', async () => {
  const { result, bar } = await scan('tests/fixtures/menu-scan-mixed.jpg', 'Testcafé Zürich');
  const { prices } = menuPrices(result.parsed, bar, '2026-10-16');
  expect(prices.map(p => [p.input.drink, p.input.priceChf, p.input.volumeMl])).toEqual(expect.arrayContaining([
    ['beer', 4.9, 300], ['beer', 7.5, 500], ['beer', 6.2, 330], ['beer', 5.8, 330], ['beer', 8, 500],
    ['coffee', 4.5, null], ['coffee', 5.8, null], ['coffee', 6.8, null], ['pizza', 18, null],
  ]));
  expect(prices).toHaveLength(9);
  expect(prices.find(p => p.input.name.includes('Chopfab'))?.input.beerType).toBe('bottle');
  expect(prices.find(p => p.input.name.includes('Feldschlösschen'))?.input).toMatchObject({ beerType: 'bottle', alcoholFree: true });
  expect(prices.find(p => p.input.name === 'IPA')?.input.beerType).toBe('can');
}, 90000);
it.skipIf(!enabled)('reads a dark tap board at phone-upload resolution', async () => {
  const { result, bar } = await scan('tests/fixtures/menu-scan-taps.jpg', 'Testbar');
  const { prices } = menuPrices(result.parsed, bar, '2026-10-16');
  // Faint rows may be rejected, but every saved price must match the board; the 5 dl Session IPA is cut off.
  const board: Record<string, number[][]> = { Zwickel: [[300, 7], [500, 9.5]], 'Hill IPA': [[300, 10], [500, 15]], 'Pale Ale': [[300, 10], [500, 15]],
    Kundert: [[300, 7], [500, 9.5]], Sprint: [[300, 5], [500, 7.5]], Rekord: [[300, 6], [500, 8.5]], Session: [[300, 9]] };
  for (const p of prices) {
    const name = Object.keys(board).find(n => p.input.name.includes(n));
    expect(name, p.input.name).toBeDefined();
    expect(board[name!]).toContainEqual([p.input.volumeMl, p.input.priceChf]);
  }
  for (const name of ['Zwickel', 'Sprint', 'Rekord', 'Hill IPA']) expect(prices.filter(p => p.input.name.includes(name))).toHaveLength(2);
  expect(prices.every(p => ['draft', 'unknown'].includes(p.input.beerType!))).toBe(true);
}, 90000);
it.skipIf(!enabled)('does not save an unreadable menu', async () => {
  const { result, bar } = await scan('tests/fixtures/menu-scan-unreadable.jpg', 'Mars Bar');
  let prices: unknown[] = [];
  try { prices = menuPrices(result.parsed, bar, '2026-10-16').prices; } catch { /* unreadable documents are rejected */ }
  expect(prices).toEqual([]);
}, 90000);
it.skipIf(!enabled)('rejects a photo visibly belonging to another venue', async () => {
  const { result, bar } = await scan('tests/fixtures/menu-scan-table.jpg', 'Restaurant Anders, Bern');
  expect(() => menuPrices(result.parsed, bar, '2026-10-16')).toThrow();
}, 90000);
it.skipIf(!enabled)('rejects a matching restaurant name with a clearly different branch address', async () => {
  const bar = { ...venue('Mars Bar'), address: 'Bundesplatz 1', postcode: '3011' };
  const result = await readMenu({ data: readFileSync('tests/fixtures/menu-scan-table.jpg').toString('base64'), mediaType: 'image/jpeg' },
    bar, process.env.ANTHROPIC_API_KEY!);
  expect(result.usage.costUsd).toBeLessThanOrEqual(OCR_BUDGET_USD);
  expect(() => menuPrices(result.parsed, bar, '2026-10-16')).toThrow('anderen Lokal');
}, 90000);

});
