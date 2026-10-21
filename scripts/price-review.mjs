import { get } from '@vercel/blob';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { reviewRows, reviewHtml, reviewCsv } from '../server/price-review.mjs';
export { reviewRows, reviewHtml, reviewCsv } from '../server/price-review.mjs';
const cities = { zurich: 'Zürich', bern: 'Bern', basel: 'Basel', lausanne: 'Lausanne', geneva: 'Genf' };

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--development', '--production'].includes(arg)) || (args.includes('--development') && args.includes('--production'))) {
    throw new Error('Aufruf: npm run prices:review [-- --development | --production]');
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN fehlt. Den bestehenden privaten Store-Token in .env.local setzen.');
  const environment = args.includes('--development') ? 'development' : 'production';
  const rows = [];
  // All cities must load successfully before replacing the last complete report.
  for (const city of Object.keys(cities)) {
    const path = `prices/${city === 'zurich' ? '' : city + '/'}${environment}.json`;
    const response = await get(path, { access: 'private', useCache: false });
    const state = response ? response.statusCode === 200 ? await new Response(response.stream).json() : null : { entries: [], history: [] };
    if (!state || !Array.isArray(state.entries) || !Array.isArray(state.history) || (state.priceChanges !== undefined && !Array.isArray(state.priceChanges))) {
      throw new Error(`Preisspeicher für ${cities[city]} konnte nicht vollständig gelesen werden.`);
    }
    const catalogue = JSON.parse(await readFile(new URL(`../public/data/${city === 'zurich' ? '' : city + '/'}locations.json`, import.meta.url), 'utf8'));
    rows.push(...reviewRows(state, city, catalogue.bars));
  }
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision);
  const directory = resolve(`output/price-review/${environment}`);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/price-changes.csv`, reviewCsv(rows));
  await writeFile(`${directory}/price-changes.json`, JSON.stringify(rows, null, 2));
  await writeFile(`${directory}/index.html`, reviewHtml(rows, environment));
  console.log(`${rows.length} manuelle Einträge / Änderungen (${environment}).\nÜbersicht: ${directory}/index.html\nCSV: ${directory}/price-changes.csv`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Preisübersicht konnte nicht erstellt werden:', error instanceof Error ? error.message : 'Unbekannter Fehler'); process.exitCode = 1; });
}
