import { randomUUID } from 'node:crypto';
import { applyEntries, matchesOfferKey, offerKey, type PriceEntry } from '../src/community.js';
import type { Dataset, Offer } from '../src/data.js';

export type PriceChange = {
  id: string;
  entryId: string;
  revision: number;
  updatedAt: string;
  barId: string;
  venueName: string;
  address: string;
  drink: PriceEntry['drink'];
  targetKey: string;
  source: 'manual';
  before: Offer | null;
  after: Offer;
};

// Snapshot the price actually displayed, including a newer verified website menu.
// Keeping copies makes later catalogue refreshes irrelevant to the audit trail.
export function priceChange(entry: PriceEntry, previous: PriceEntry | undefined, dataset: Dataset | undefined): PriceChange {
  const bar = dataset?.bars.find(b => b.id === entry.barId) || entry.venue!;
  const visible = applyEntries({ generatedAt: '', discoveredAt: '', attribution: '', bars: [bar] },
    previous ? [previous] : [], [bar], entry.drink).bars[0].offers;
  const before = previous
    ? visible.find(o => o.communityId === previous.id)
    : visible.find(o => matchesOfferKey(o, entry.targetKey, visible) || offerKey(o) === offerKey(entry.offer));
  return {
    id: randomUUID(), entryId: entry.id, revision: entry.revision, updatedAt: entry.updatedAt,
    barId: entry.barId, venueName: entry.venue!.name, address: entry.venue!.address,
    drink: entry.drink, targetKey: entry.targetKey, source: 'manual',
    before: before ? structuredClone(before) : null, after: structuredClone(entry.offer),
  };
}
