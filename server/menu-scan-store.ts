import { randomUUID } from 'node:crypto';
import { InputError, offerKey, type PriceEntry } from '../src/community.js';
import { offerCategory, type Bar, type Offer } from '../src/data.js';
import { WriteConflict, type Store, type State, type ScanReceipt } from './prices.js';
import { OCR_MODEL, type ScannedPrice } from './menu-ocr.js';

async function change<T>(store: Store, update: (state: State) => T): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const result = update(state);
    try { await store.write(state, etag); return result; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden weitere Preise gespeichert. Bitte später erneut versuchen.', 409);
}
export function scanResult(state: State, receipt: ScanReceipt) {
  return { ...receipt, entries: state.entries.filter(e => receipt.ids.includes(e.id)) };
}
export async function reserveScan(store: Store, hash: string, visitor: string, now = Date.now()) {
  // Limits and deduplication use conditional writes, shared across server instances.
  return change(store, state => {
    state.menuScans = Object.fromEntries(Object.entries(state.menuScans || {}).filter(([, job]) => job.expires > now));
    const old = state.menuScans[hash];
    if (old?.status === 'done' && old.result) return scanResult(state, old.result);
    if (old?.status === 'pending') throw new InputError('Dieses Foto wird bereits verarbeitet. Bitte kurz warten.', 409);
    if (old?.status === 'failed') throw new InputError('Dieses Foto konnte nicht sicher verarbeitet werden. Bitte einen neuen, näheren Ausschnitt fotografieren.', 422);
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, value]) => value.expires > now));
    for (const [key, max, ttl] of [[`scan:${visitor}`, 6, 3600000], ['scan:daily', 1000, 86400000]] as const) {
      const oldLimit = state.limits[key] || { count: 0, expires: now + ttl };
      if (oldLimit.count >= max) throw new InputError('Das Scan-Limit ist erreicht. Bitte später erneut versuchen oder Preise einzeln eintragen.', 429);
      state.limits[key] = { ...oldLimit, count: oldLimit.count + 1 };
    }
    state.menuScans[hash] = { status: 'pending', expires: now + 86400000 };
    return undefined;
  });
}
export async function failScan(store: Store, hash: string) {
  await change(store, state => {
    const job = state.menuScans?.[hash];
    if (job?.status === 'pending') job.status = 'failed';
  });
}
function identity(offer: Offer) {
  return offerKey({ ...offer, name: offer.name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') });
}
export async function saveMenuScan(store: Store, hash: string, bar: Bar, originals: Offer[], prices: ScannedPrice[], skipped: number, now = Date.now()) {
  return change(store, state => {
    const job = state.menuScans?.[hash];
    if (job?.status === 'done' && job.result) return scanResult(state, job.result);
    if (job?.status !== 'pending') throw new InputError('Der Scan ist nicht mehr verfügbar. Bitte erneut fotografieren.', 409);
    const receipt: ScanReceipt = { ids: [], added: 0, unchanged: 0, conflicts: 0, skipped };
    const grouped = new Map<string, { offer: Offer; drink: PriceEntry['drink'] }[]>();
    for (const { input, evidence } of prices) {
      const { name, priceChf, volumeMl, beerType, coffeeType, pizzaType, serving, alcoholFree, observedAt } = input;
      const offer: Offer = { name, priceChf, volumeMl, beerType, coffeeType, pizzaType, serving, alcoholFree, observedAt,
        sourceUrl: '', confidence: 'ai', evidence, menuScan: { sha256: hash, model: OCR_MODEL } };
      const key = identity(offer);
      grouped.set(key, [...(grouped.get(key) || []), { offer, drink: input.drink }]);
    }
    for (const [key, group] of grouped) {
      if (new Set(group.map(g => g.offer.priceChf)).size > 1) { receipt.conflicts++; continue; }
      const { offer, drink } = group[0];
      const existing = state.entries.filter(e => e.barId === bar.id && e.drink === drink && identity(e.offer) === key);
      const scraped = originals.filter(o => offerCategory(o) === drink && identity(o) === key);
      const prior = existing.length ? existing.map(e => e.offer) : scraped;
      if (prior.length) {
        if (prior.every(o => o.priceChf === offer.priceChf)) { receipt.unchanged++; receipt.ids.push(...existing.map(e => e.id)); }
        else receipt.conflicts++;
        continue;
      }
      const entry: PriceEntry = { id: randomUUID(), barId: bar.id, drink, targetKey: offerKey(offer), revision: 1,
        updatedAt: new Date(now).toISOString(), offer, venue: { ...bar, offers: [] } };
      state.entries.push(entry); receipt.ids.push(entry.id); receipt.added++;
    }
    // Price entries and the completed receipt commit together; no partial menus.
    job.status = 'done'; job.result = receipt;
    return scanResult(state, receipt);
  });
}
