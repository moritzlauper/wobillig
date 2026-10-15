import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { del } from '@vercel/blob';
import { blobStore, savePrice } from '../server/prices';
import { offerKey, type PriceInput } from '../src/community';
import type { Dataset } from '../src/data';

// Explicit opt-in; uses a temporary key, never either live dataset.
it.skipIf(process.env.RUN_BLOB_INTEGRATION !== '1')('persists repeated edits and concurrent additions across store instances', async () => {
  const path = `tests/prices-${randomUUID()}.json`;
  const store = blobStore(path), secondInstance = blobStore(path);
  const beer = JSON.parse(await readFile('public/data/bars.json', 'utf8')) as Dataset;
  const coffee = JSON.parse(await readFile('public/data/coffee.json', 'utf8')) as Dataset;
  const bar = beer.bars.find(b => b.offers.some(o => o.volumeMl === 500))!;
  const offer = bar.offers.find(o => o.volumeMl === 500)!;
  const input: PriceInput = { barId: bar.id, drink: 'beer', revision: 0, targetKey: offerKey(offer), name: offer.name, priceChf: offer.priceChf, volumeMl: 500, alcoholFree: offer.alcoholFree, observedAt: '2026-10-15', sourceUrl: offer.sourceUrl };
  try {
    const entry = await savePrice(store, input, { beer, coffee }, 'test');
    // History grows past the compression threshold, exercising strong ETags on reads.
    for (let revision = 1; revision < 6; revision++) {
      await savePrice(secondInstance, { ...input, id: entry.id, revision, priceChf: 5 + revision }, { beer, coffee }, 'test');
      const saved = (await store.read()).state.entries[0];
      expect(saved.revision).toBe(revision + 1);
      expect(saved.offer.priceChf).toBe(5 + revision);
    }
    await Promise.all(['A', 'B'].map(name => savePrice(blobStore(path), { ...input, name, targetKey: undefined }, { beer, coffee }, name)));
    const state = (await secondInstance.read()).state;
    expect(state.entries).toHaveLength(3);
    expect(state.history).toHaveLength(5);
  } finally { await del(path); }
}, 60000);
