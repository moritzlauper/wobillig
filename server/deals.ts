import { createHash } from 'node:crypto';
import { InputError } from '../src/community.js';
import { currentDeal, wineTypeLabels, type DealBatch, type DealBranch, type DealPilot, type Deal } from '../src/deal-data.js';
import { WriteConflict, type Store } from './prices.js';

const string = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x);
function sourceUrl(x: unknown, hosts: string[]) {
  if (!string(x, 2000)) return false;
  try { const url = new URL(x); return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname); } catch { return false; }
}
const date = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const amount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 2000;
const page = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 100;
const chainHosts = { coop: ['www.coop.ch', 'coop.ch', 'epaper.coop.ch'], migros: ['www.migros.ch', 'migros.ch', 'filialen.migros.ch'] };
const brochureHosts = { coop: ['epaper.coop.ch'], migros: [] };
const shopHosts = { coop: ['www.coop.ch'], migros: ['www.migros.ch'] };
// OSM candidates link to OpenStreetMap, branches from the retailer's store search to its branch page.
const branchSource = (branch: DealBranch) => /^(?:node|way|relation)\/\d+$/.test(branch.id) ? branch.sourceUrl === `https://www.openstreetmap.org/${branch.id}`
  : branch.chain === 'coop' && /^coop\/\d+$/.test(branch.id) && sourceUrl(branch.sourceUrl, ['www.coop.ch']) && new URL(branch.sourceUrl).pathname.startsWith('/de/standorte/');
export function validateDealBatch(value: unknown, now = Date.now()): DealBatch {
  const bad = () => new InputError('Ungültiger Aktionsimport. Quelle, Preise, Gültigkeit und Filialdaten prüfen.');
  if (!value || typeof value !== 'object') throw bad();
  const input = value as DealBatch, source = input.source, shop = source?.kind === 'shop';
  if (!source || !['coop', 'migros'].includes(source.chain) || !string(source.id, 80) || !string(source.label, 150) ||
    ![undefined, 'brochure', 'shop'].includes(source.kind) ||
    !string(source.scopeLabel, 200) || !sourceUrl(source.url, chainHosts[source.chain]) || !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isFinite(Date.parse(source.fetchedAt)) || Date.parse(source.fetchedAt) > now + 300000 ||
    !Array.isArray(input.offers) || input.offers.length < 1 || input.offers.length > 600 ||
    !Array.isArray(input.branches) || input.branches.length > 150) throw bad();
  const ids = new Set<string>();
  const branches = input.branches.map(branch => {
    if (!branch || !string(branch.id, 100) || ids.has(branch.id) || branch.chain !== source.chain || !branchSource(branch) ||
      !string(branch.name, 150) || !string(branch.address, 200) || !/^80\d{2}$/.test(branch.postcode) ||
      !Number.isFinite(branch.lat) || !Number.isFinite(branch.lon) || branch.lat < 47.30 || branch.lat > 47.45 || branch.lon < 8.40 || branch.lon > 8.65) throw bad();
    ids.add(branch.id);
    return { id: branch.id, chain: branch.chain, name: branch.name, address: branch.address, postcode: branch.postcode,
      lat: branch.lat, lon: branch.lon, sourceUrl: branch.sourceUrl };
  });
  const branchIds = new Set(ids); ids.clear();
  const offers = input.offers.map((offer): Deal => {
    if (!offer || !string(offer.id, 100) || ids.has(offer.id) || offer.chain !== source.chain || !string(offer.product, 250) ||
      !string(offer.quantity, 200) || !['food', 'drinks', 'household', 'other'].includes(offer.category) ||
      !amount(offer.priceChf) || !amount(offer.previousPriceChf) || offer.priceChf >= offer.previousPriceChf ||
      !string(offer.priceBasis, 100) || !string(offer.conditions, 500) || !date(offer.validFrom) || !date(offer.validThrough) ||
      offer.validFrom > offer.validThrough || Date.parse(offer.validThrough) - Date.parse(offer.validFrom) > 31 * 86400000 ||
      (shop ? !sourceUrl(offer.sourceUrl, shopHosts[source.chain]) || offer.sourcePage !== undefined
        : offer.sourceUrl !== source.url || !page(offer.sourcePage)) ||
      !sourceUrl(offer.sourceUrl, chainHosts[source.chain]) || !string(offer.evidence, 1500) ||
      (offer.unitPrice && (!amount(offer.unitPrice.amount) || !['kg', 'l', 'piece'].includes(offer.unitPrice.unit))) ||
      // Without a published end date the listing only proves the price on the day it was read.
      ![undefined, true].includes(offer.endUnknown) || (offer.endUnknown && (!shop || offer.validFrom !== offer.validThrough || offer.brochure)) ||
      ![undefined, true].includes(offer.onlineOnly) || (offer.onlineOnly && offer.availableAt?.length) ||
      (offer.wineType !== undefined && !(offer.wineType in wineTypeLabels)) || ![undefined, true].includes(offer.natural) || (offer.origin !== undefined && !string(offer.origin, 100)) ||
      (offer.availableAt !== undefined && (!Array.isArray(offer.availableAt) || offer.availableAt.length > 150 ||
        new Set(offer.availableAt).size !== offer.availableAt.length || offer.availableAt.some(id => !branchIds.has(id)))) ||
      (offer.brochure !== undefined && (!shop || !sourceUrl(offer.brochure.url, brochureHosts[source.chain]) || !page(offer.brochure.page)))) throw bad();
    ids.add(offer.id);
    return { id: offer.id, chain: offer.chain, product: offer.product, quantity: offer.quantity, category: offer.category,
      priceChf: offer.priceChf, previousPriceChf: offer.previousPriceChf, priceBasis: offer.priceBasis,
      ...(offer.unitPrice ? { unitPrice: { amount: offer.unitPrice.amount, unit: offer.unitPrice.unit } } : {}),
      conditions: offer.conditions, validFrom: offer.validFrom, validThrough: offer.validThrough,
      sourceUrl: offer.sourceUrl, ...(shop ? {} : { sourcePage: offer.sourcePage }), evidence: offer.evidence,
      ...(offer.endUnknown ? { endUnknown: true } : {}), ...(offer.onlineOnly ? { onlineOnly: true } : {}),
      ...(offer.wineType ? { wineType: offer.wineType } : {}), ...(offer.natural ? { natural: true } : {}), ...(offer.origin ? { origin: offer.origin } : {}),
      ...(offer.availableAt ? { availableAt: [...offer.availableAt] } : {}),
      ...(offer.brochure ? { brochure: { url: offer.brochure.url, page: offer.brochure.page } } : {}) };
  });
  return { source: { id: source.id, chain: source.chain, label: source.label, url: source.url, sha256: source.sha256,
    fetchedAt: source.fetchedAt, scopeLabel: source.scopeLabel, ...(source.kind ? { kind: source.kind } : {}) }, offers, branches };
}
export const dealFingerprint = (batch: DealBatch) => createHash('sha256').update(JSON.stringify({ ...batch, source: { ...batch.source, fetchedAt: undefined } })).digest('hex');
function freshBatch(input: unknown, now: number, kind: 'brochure' | 'shop') {
  const batch = validateDealBatch(input, now);
  if ((batch.source.kind || 'brochure') !== kind) throw new InputError('Falsche Importart für diese Quelle.');
  // An old cached download cannot replace current data or mark a failed refresh as successful.
  if (now - Date.parse(batch.source.fetchedAt) > 86400000 || !batch.offers.some(offer => currentDeal(offer, now))) {
    throw new InputError('Der Import enthält keine aktuell gültigen Angebote oder wurde nicht frisch abgerufen.', 422);
  }
  return batch;
}
export async function importDeals(store: Store, input: unknown, now = Date.now()) {
  const batch = freshBatch(input, now, 'brochure'), fingerprint = dealFingerprint(batch);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read(), previous = state.dealPilot;
    if (previous?.batch && previous.batch.source.fetchedAt > batch.source.fetchedAt) throw new InputError('Ein neuerer Aktionsimport ist bereits vorhanden.', 409);
    state.dealPilot = { batch, fingerprint, revision: (previous?.revision || 0) + 1,
      assignments: previous?.fingerprint === fingerprint ? previous.assignments : [],
      lastAttemptAt: new Date(now).toISOString(), lastSuccessAt: batch.source.fetchedAt };
    try { await store.write(state, etag); return state.dealPilot; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Der Aktionspilot wird gerade geändert. Bitte erneut versuchen.', 409);
}
// Shop sweeps live beside the brochure pilot, so the daily brochure import never replaces them.
export async function importDealSweep(store: Store, input: unknown, now = Date.now()) {
  const batch = freshBatch(input, now, 'shop');
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    if (state.dealSweep && state.dealSweep.source.fetchedAt > batch.source.fetchedAt) throw new InputError('Ein neuerer Sweep ist bereits vorhanden.', 409);
    state.dealSweep = batch;
    try { await store.write(state, etag); return batch; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Der Aktionspilot wird gerade geändert. Bitte erneut versuchen.', 409);
}
export async function recordDealFailure(store: Store, now = Date.now()) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    if (state.dealPilot && Date.parse(state.dealPilot.lastAttemptAt) > now) return;
    state.dealPilot = { ...(state.dealPilot || { revision: 0, assignments: [] }), lastAttemptAt: new Date(now).toISOString(),
      lastError: 'Der letzte Import ist fehlgeschlagen. Der letzte erfolgreiche Datenstand bleibt erhalten.' };
    try { await store.write(state, etag); return; } catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new Error('Deal failure status could not be stored');
}
export async function assignDeal(store: Store, input: Record<string, unknown>, now = Date.now()) {
  if (!Number.isSafeInteger(input.revision) || !string(input.fingerprint, 64) || !string(input.branchId, 100) || !string(input.offerId, 100) ||
    !['confirm', 'remove'].includes(String(input.action))) throw new InputError('Ungültige Filialzuordnung.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read(), pilot = state.dealPilot;
    if (!pilot?.batch || pilot.revision !== input.revision || pilot.fingerprint !== input.fingerprint) throw new InputError('Der Aktionspilot wurde inzwischen geändert. Bitte neu laden.', 409);
    const branch = pilot.batch.branches.find(b => b.id === input.branchId), offer = pilot.batch.offers.find(o => o.id === input.offerId);
    if (!branch || !offer || branch.chain !== offer.chain || !currentDeal(offer, now)) throw new InputError('Filiale oder aktuelles Angebot nicht gefunden.', 422);
    if (input.action === 'confirm' && (!sourceUrl(input.evidenceUrl, chainHosts[offer.chain]) || !string(input.evidence, 600))) {
      throw new InputError('Bitte einen Händlerlink und einen Beleg für die Gültigkeit in dieser Filiale angeben.');
    }
    pilot.assignments = pilot.assignments.filter(item => item.branchId !== branch.id || item.offerId !== offer.id);
    if (input.action === 'confirm') pilot.assignments.push({ branchId: branch.id, offerId: offer.id,
      evidence: (input.evidence as string).trim(), evidenceUrl: input.evidenceUrl as string, reviewedAt: new Date(now).toISOString() });
    pilot.revision++;
    try { await store.write(state, etag); return pilot; } catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Der Aktionspilot wird gerade geändert. Bitte erneut versuchen.', 409);
}
export const emptyDealPilot = (): DealPilot => ({ revision: 0, assignments: [], lastAttemptAt: '' });
