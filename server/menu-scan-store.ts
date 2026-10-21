import { reviewRequired } from './community-policy.js';
import { checkReviewCapacity } from './community-policy.js';
import { randomUUID } from 'node:crypto';
import { InputError, matchesOfferKey, offerKey, type PriceEntry } from '../src/community.js';
import { offerCategory, type Bar, type Offer } from '../src/data.js';
import { WriteConflict, type Store, type State, type ScanReceipt } from './prices.js';
import { OCR_MODEL, type ScannedPrice } from './menu-ocr.js';
import { priceChange } from './price-audit.js';

export type ScanEdit = { id?: string; revision: number; targetKey: string; drink: PriceEntry['drink'] };
export function parseScanEdit(value: unknown): ScanEdit {
  const edit = value as ScanEdit | null;
  if (!edit || typeof edit.targetKey !== 'string' || edit.targetKey.length > 1000 ||
      !Number.isInteger(edit.revision) || edit.revision < 0 ||
      !['beer', 'coffee', 'pizza'].includes(edit.drink) || (edit.id !== undefined && typeof edit.id !== 'string')) {
    throw new InputError('Ungültiges Angebot.');
  }
  return { id: edit.id, revision: edit.revision, targetKey: edit.targetKey, drink: edit.drink };
}
export function resolveScanEdit(value: unknown, bar: Bar, originals: Offer[], entries: PriceEntry[]) {
  const edit = parseScanEdit(value);
  const old = entries.find(entry => edit.id ? entry.id === edit.id :
    entry.barId === bar.id && entry.drink === edit.drink && entry.targetKey === edit.targetKey);
  if ((edit.id && !old) || old && (old.barId !== bar.id || old.drink !== edit.drink || old.targetKey !== edit.targetKey) ||
      (old?.revision || 0) !== edit.revision) {
    throw new InputError('Dieser Preis wurde inzwischen geändert. Bitte schliessen und erneut öffnen.', 409);
  }
  const offers = originals.filter(offer => offerCategory(offer) === edit.drink);
  const offer = old?.offer || offers.find(offer => matchesOfferKey(offer, edit.targetKey, offers));
  if (!offer) throw new InputError('Das ursprüngliche Angebot ist nicht mehr vorhanden. Bitte neu laden.', 409);
  return { edit: { id: edit.id, revision: edit.revision, targetKey: edit.targetKey, drink: edit.drink }, old, offer };
}

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
  const entries = state.entries.filter(e => receipt.ids.includes(e.id));
  const published = receipt.ids.length > 0 && receipt.ids.every(id => entries.some(entry => entry.id === id));
  return { ...receipt, ...(receipt.pending && published ? { pending: false } : {}), entries };
}
export async function reserveScan(store: Store, hash: string, visitor: string, now = Date.now()) {
  // Limits and deduplication use conditional writes, shared across server instances.
  return change(store, state => {
    state.menuScans = Object.fromEntries(Object.entries(state.menuScans || {}).filter(([, job]) => job.expires > now));
    const old = state.menuScans[hash];
    if (old?.status === 'done' && old.result) return scanResult(state, old.result);
    if (old?.status === 'pending') throw new InputError('Dieses Foto wird bereits verarbeitet. Bitte kurz warten.', 409);
    if (old?.status === 'failed') throw new InputError('Der letzte Scan ist fehlgeschlagen. Bitte kurz warten und dasselbe Foto erneut hochladen.', 429);
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, value]) => value.expires > now));
    for (const [key, max, ttl] of [[`scan:${visitor}`, 12, 3600000], ['scan:daily', 1000, 86400000]] as const) {
      const oldLimit = state.limits[key] || { count: 0, expires: now + ttl };
      if (oldLimit.count >= max) throw new InputError('Das Scan-Limit ist erreicht. Bitte später erneut versuchen oder Preise einzeln eintragen.', 429);
      state.limits[key] = { ...oldLimit, count: oldLimit.count + 1 };
    }
    state.menuScans[hash] = { status: 'pending', expires: now + 86400000 };
    return undefined;
  });
}
export async function failScan(store: Store, hash: string, now = Date.now()) {
  await change(store, state => {
    const job = state.menuScans?.[hash];
    if (job?.status === 'pending') { job.status = 'failed'; job.expires = now + 15000; }
  });
}
function identity(offer: Offer) {
  return offerKey({ ...offer, name: offer.name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') });
}
export async function saveMenuScan(store: Store, hash: string, bar: Bar, originals: Offer[], prices: ScannedPrice[], skipped: number, now = Date.now(), edit?: ScanEdit, owner?: string) {
  return change(store, state => {
    const job = state.menuScans?.[hash];
    if (job?.status === 'done' && job.result) return scanResult(state, job.result);
    if (job?.status !== 'pending') throw new InputError('Der Scan ist nicht mehr verfügbar. Bitte erneut fotografieren.', 409);
    const target = edit ? resolveScanEdit(edit, bar, originals, state.entries) : undefined;
    const originalEntries = [...state.entries], originalHistory = [...state.history], originalChanges = [...(state.priceChanges || [])];
    const receipt: ScanReceipt = { ids: [], added: 0, unchanged: 0, conflicts: 0, skipped };
    const grouped = new Map<string, { offer: Offer; drink: PriceEntry['drink'] }[]>();
    for (const { input, evidence } of prices) {
      const { name, priceChf, volumeMl, beerType, coffeeType, pizzaType, serving, alcoholFree, observedAt } = input;
      const offer: Offer = { name, priceChf, volumeMl, beerType, coffeeType, pizzaType, serving, alcoholFree, observedAt,
        sourceUrl: '', confidence: 'ai', evidence, menuScan: { sha256: hash, model: OCR_MODEL } };
      const key = identity(offer);
      grouped.set(key, [...(grouped.get(key) || []), { offer, drink: input.drink }]);
    }
    if (target) {
      const matches = grouped.get(identity(target.offer));
      if (!matches || new Set(matches.map(row => row.offer.priceChf)).size !== 1) {
        throw new InputError('Der zu ändernde Preis ist auf diesem Foto nicht eindeutig erkennbar. Bitte einen passenden Kartenausschnitt hochladen.', 422);
      }
    }
    for (const [key, group] of grouped) {
      if (new Set(group.map(g => g.offer.priceChf)).size > 1) { receipt.conflicts++; continue; }
      const { offer, drink } = group[0];
      const existing = state.entries.filter(e => e.barId === bar.id && e.drink === drink && identity(e.offer) === key);
      const scraped = originals.filter(o => offerCategory(o) === drink && identity(o) === key);
      const prior = existing.length ? existing.map(e => e.offer) : scraped;
      if (prior.length) {
        if (prior.every(o => o.priceChf === offer.priceChf)) { receipt.unchanged++; receipt.ids.push(...existing.map(e => e.id)); }
        else if (target && key === identity(target.offer)) {
          const entry: PriceEntry = { id: target.old?.id || randomUUID(), barId: bar.id, drink,
            targetKey: target.edit.targetKey, revision: (target.old?.revision || 0) + 1,
            updatedAt: new Date(now).toISOString(), offer, venue: { ...bar, offers: [] } };
          const audit = priceChange(entry, target.old, { generatedAt: '', discoveredAt: '', attribution: '', bars: [{ ...bar, offers: originals }] });
          state.priceChanges = [...(state.priceChanges || []), { ...audit, source: 'menu-scan' }];
          if (target.old) state.history.push(target.old);
          state.entries = [...state.entries.filter(item => item.id !== entry.id), entry];
          state.heldPrices = state.heldPrices?.filter(item => !(item.owner === owner && item.entry.barId === bar.id &&
            item.entry.drink === drink && item.entry.targetKey === entry.targetKey));
          receipt.ids.push(entry.id);
          receipt.updated = (receipt.updated || 0) + 1;
        } else receipt.conflicts++;
        continue;
      }
      const entry: PriceEntry = { id: randomUUID(), barId: bar.id, drink, targetKey: offerKey(offer), revision: 1,
        updatedAt: new Date(now).toISOString(), offer, venue: { ...bar, offers: [] } };
      state.entries.push(entry); receipt.ids.push(entry.id); receipt.added++;
    }
    if (reviewRequired()) {
      for (const entry of state.entries) {
        const base = originalEntries.find(row => row.id === entry.id);
        if (entry === base) continue;
        checkReviewCapacity(state);
        state.heldPrices = [...(state.heldPrices || []), { owner: owner || '', entry, reason: 'menu-review-required', before: base?.offer || originals.find(offer => identity(offer) === identity(entry.offer)) || null, baseEntry: base || null }];
      }
      state.entries = originalEntries; state.history = originalHistory; state.priceChanges = originalChanges;
      receipt.pending = true;
    }
    // Price entries and the completed receipt commit together; no partial menus.
    job.status = 'done'; job.result = receipt;
    return scanResult(state, receipt);
  });
}
