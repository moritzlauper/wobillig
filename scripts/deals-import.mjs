import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const args = process.argv.slice(2);
if (args.some(arg => !['--production', '--failure'].includes(arg) && !arg.endsWith('.json'))) throw new Error('Unknown option');
const production = args.includes('--production');
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is required');
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { blobStore } = await vite.ssrLoadModule('/server/prices.ts');
  const { importDeals, recordDealFailure } = await vite.ssrLoadModule('/server/deals.ts');
  const store = blobStore(`deals/${production ? 'production' : 'development'}.json`);
  if (args.includes('--failure')) {
    await recordDealFailure(store);
    console.log('Private pilot: failed refresh recorded; previous offers and dates preserved.');
  } else {
    const input = JSON.parse(await readFile(args.find(arg => arg.endsWith('.json')) || 'output/deals/coop-zurich.json', 'utf8'));
    const result = await importDeals(store, input);
    console.log(`Private ${production ? 'production' : 'development'} pilot saved: ${result.batch.offers.length} offers. No public map created.`);
  }
} finally { await vite.close(); }
