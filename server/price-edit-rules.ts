import { InputError, type PriceEntry } from '../src/community.js';
import type { Offer } from '../src/data.js';
import type { PriceChange } from './price-audit.js';

export function checkPriceEdit(entry: PriceEntry, before: Offer | null, changes: PriceChange[], now: number) {
  if (!before) return;
  const related = changes.filter(change => change.barId === entry.barId && change.drink === entry.drink &&
    (change.entryId === entry.id || change.targetKey === entry.targetKey));
  const lastPhoto = Math.max(0, ...related.filter(change => change.source === 'menu-scan').map(change => Date.parse(change.updatedAt)));
  const recent = related.filter(change => change.source === 'manual' &&
    Date.parse(change.updatedAt) > Math.max(now - 86400000, lastPhoto)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const baseline = recent[0]?.before || recent[0]?.after || before;
  const large = [before, baseline].some(reference => {
    const cents = Math.round(reference.priceChf * 100);
    const difference = Math.abs(Math.round(entry.offer.priceChf * 100) - cents);
    return difference >= 200 && difference * 100 > cents * 30;
  });
  if (large) throw new InputError('Für grössere Preisänderungen bitte eine aktuelle Menükarte hochladen.', 422);
  if (entry.offer.priceChf !== before.priceChf &&
      recent.filter(change => change.before && change.before.priceChf !== change.after.priceChf).length >= 3) {
    throw new InputError('Dieser Preis wurde heute schon mehrfach geändert. Bitte eine aktuelle Menükarte hochladen.', 422);
  }
}
