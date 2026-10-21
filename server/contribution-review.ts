import type { Actor } from './community-security.js';
import { createHash, randomUUID } from 'node:crypto';
import { InputError, type PriceEntry } from '../src/community.js';
import { escapeHtml as e, type Bar, type Dataset } from '../src/data.js';
import { type VenueCorrection } from '../src/venue-corrections.js';
import { type City, cities } from '../src/cities.js';
import { WriteConflict, type Store, type State } from './prices.js';
import { priceChange } from './price-audit.js';

export type PendingVenue = { id: string; venue: Bar; submittedAt: string };
export type PendingCorrection = { id: string; correction: VenueCorrection; before: VenueCorrection | null; submittedAt: string };
export type ReviewUndo = { id: string; kind: 'price' | 'venue' | 'correction'; entity: string; before: PriceEntry | Bar | VenueCorrection | null; after: PriceEntry | Bar | VenueCorrection; at: string; undoneAt?: string };
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
export async function reviewContribution(store: Store, kind: string, id: string, expected: string, decision: string, datasets: Partial<Record<'beer' | 'coffee' | 'pizza', Dataset>>) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state, etag } = await store.read();
    const held = state.heldPrices?.find(row => row.entry.id === id && fingerprint(row) === expected);
    const venue = state.pendingVenues?.find(row => row.id === id);
    const correction = state.pendingCorrections?.find(row => row.id === id);
    const undo = state.reviewUndo?.find(row => row.id === id && !row.undoneAt);
    const row = kind === 'price' ? held : kind === 'venue' ? venue : kind === 'correction' ? correction : kind === 'undo' ? undo : undefined;
    if (!row || fingerprint(row) !== expected) throw new InputError('Eintrag inzwischen geändert. Bitte neu laden.', 409);
    const at = new Date().toISOString();
    if (kind === 'undo' && undo && decision === 'undo') {
      const current = undo.kind === 'price' ? state.entries.find(row => row.id === undo.entity) : undo.kind === 'venue' ? state.venues?.find(row => row.id === undo.entity) : state.venueCorrections?.find(row => row.barId === undo.entity);
      if (fingerprint(current) !== fingerprint(undo.after)) throw new InputError('Seit der Freigabe geändert. Rücknahme würde neuere Daten überschreiben.', 409);
      if (undo.kind === 'venue' && (state.entries.some(row => row.barId === undo.entity) || state.customMaps?.some(map => map.entries.some(row => row.venue.id === undo.entity)))) throw new InputError('Das Lokal wird inzwischen verwendet. Bitte zugehörige Beiträge zuerst zurücknehmen.', 409);
      if (undo.kind === 'price') state.entries = [...state.entries.filter(row => row.id !== undo.entity), ...(undo.before ? [undo.before as PriceEntry] : [])];
      if (undo.kind === 'venue') state.venues = [...(state.venues || []).filter(row => row.id !== undo.entity), ...(undo.before ? [undo.before as Bar] : [])];
      if (undo.kind === 'correction') state.venueCorrections = [...(state.venueCorrections || []).filter(row => row.barId !== undo.entity), ...(undo.before ? [undo.before as VenueCorrection] : [])];
      undo.undoneAt = at;
    } else {
      if (!['approve', 'reject'].includes(decision)) throw new InputError('Ungültige Entscheidung.');
      if (decision === 'approve') {
        let change: Omit<ReviewUndo, 'id' | 'at'>;
        if (kind === 'price' && held) {
          const entry = held.entry;
          const old = state.entries.find(row => row.id === entry.id || row.barId === entry.barId && row.drink === entry.drink && row.targetKey === entry.targetKey);
          if (held.baseEntry !== undefined ? fingerprint(old) !== fingerprint(held.baseEntry) : old && fingerprint(old.offer) !== fingerprint(held.before)) throw new InputError('Der öffentliche Preis wurde inzwischen geändert.', 409);
          const approved = { ...entry, revision: (old?.revision || 0) + 1, updatedAt: at };
          state.entries = [...state.entries.filter(row => row.id !== old?.id && row.id !== approved.id), approved];
          if (old) state.history.push(old);
          const dataset = datasets[entry.drink];
          if (dataset) state.priceChanges = [...(state.priceChanges || []), priceChange(approved, old, dataset)];
          change = { kind: 'price', entity: approved.id, before: old || null, after: approved };
        } else if (kind === 'venue' && venue) {
          if (state.venues?.some(row => row.id === venue.venue.id)) throw new InputError('Lokal bereits vorhanden.', 409);
          state.venues = [...(state.venues || []), venue.venue];
          change = { kind: 'venue', entity: venue.venue.id, before: null, after: venue.venue };
        } else if (kind === 'correction' && correction) {
          const old = state.venueCorrections?.find(row => row.barId === correction.correction.barId);
          if (fingerprint(old) !== fingerprint(correction.before)) throw new InputError('Das Lokal wurde inzwischen korrigiert.', 409);
          state.venueCorrections = [...(state.venueCorrections || []).filter(row => row.barId !== correction.correction.barId), correction.correction];
          change = { kind: 'correction', entity: correction.correction.barId, before: old || null, after: correction.correction };
        } else throw new InputError('Ungültiger Eintrag.');
        state.reviewUndo = [...(state.reviewUndo || []), { ...change, id: randomUUID(), at }];
      }
      if (kind === 'price') state.heldPrices = state.heldPrices?.filter(row => row !== held);
      if (kind === 'venue') state.pendingVenues = state.pendingVenues?.filter(row => row !== venue);
      if (kind === 'correction') state.pendingCorrections = state.pendingCorrections?.filter(row => row !== correction);
    }
    try { await store.write(state, etag); return; } catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Bitte erneut versuchen.', 409);
}
export function contributionReviewHtml(groups: { city: City; state: State }[]) {
  const cards: string[] = [];
  function card(city: City, kind: string, id: string, row: unknown, title: string, details: unknown, undo = false) {
    cards.push(`<article><h2>${e(title)}</h2><p>${e(cities[city].name)}</p><pre>${e(JSON.stringify(details, null, 2))}</pre><form method="post"><input type="hidden" name="city" value="${city}"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${e(id)}"><input type="hidden" name="fingerprint" value="${fingerprint(row)}">${undo ? '<button name="decision" value="undo">Freigabe zurücknehmen</button>' : '<button name="decision" value="approve">Freigeben</button><button name="decision" value="reject">Ablehnen</button>'}</form></article>`);
  }
  for (const { city, state } of groups) {
    for (const map of state.customMaps || []) {
      if (map.automatic || state.mapOwners?.[map.id]) continue;
      cards.push(`<article><h2>Bestehende Map: ${e(map.name)}</h2><p>${e(cities[city].name)} · Bisher ohne Bearbeitungsberechtigung. Nur als Administrator kannst du sie deinem aktuellen Konto oder Browser zuweisen.</p><form method="post"><input type="hidden" name="city" value="${city}"><input type="hidden" name="kind" value="legacy-map"><input type="hidden" name="id" value="${e(map.id)}"><input type="hidden" name="fingerprint" value="${fingerprint(map)}"><button name="decision" value="claim">Bearbeitung diesem Konto / Browser zuweisen</button></form></article>`);
    }
    for (const row of state.heldPrices || []) card(city, 'price', row.entry.id, row, row.entry.venue?.name || 'Preis', { vorher: row.before, nachher: row.entry.offer, grund: row.reason });
    for (const row of state.pendingVenues || []) card(city, 'venue', row.id, row, 'Neues Lokal', row.venue);
    for (const row of state.pendingCorrections || []) card(city, 'correction', row.id, row, 'Lokal korrigieren', { vorher: row.before, nachher: row.correction });
    for (const row of (state.reviewUndo || []).filter(row => !row.undoneAt).slice(-50).reverse()) card(city, 'undo', row.id, row, 'Freigegebener Beitrag', { zeit: row.at, vorher: row.before, nachher: row.after }, true);
  }
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beiträge prüfen · wobillig</title><style>body{font:16px system-ui;background:#f4f5f1;color:#173329;margin:0}main{max-width:960px;margin:auto;padding:24px}article{background:white;padding:20px;margin:20px 0;border:1px solid #ccd8ce;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px system-ui}button{font:inherit;padding:12px;margin-right:10px}a{color:inherit}</style><main><a href="/output/price-review/production">Preisübersicht</a> · <a href="/api/map-review">Maps prüfen</a><h1>Beiträge prüfen</h1><p>Nur geprüfte Beiträge werden öffentlich. Veraltete Freigaben und Rücknahmen werden abgewiesen.</p>${cards.join('') || '<p>Keine Beiträge zur Prüfung.</p>'}</main></html>`;
}

export async function claimLegacyMap(store: Store, id: string, expected: string, actor: Actor) {
  for (let i = 0; i < 8; i++) {
    const { state, etag } = await store.read();
    const map = state.customMaps?.find(row => row.id === id);
    if (!map || map.automatic || state.mapOwners?.[id] || fingerprint(map) !== expected) throw new InputError('Eintrag inzwischen geändert. Bitte neu laden.', 409);
    state.mapOwners = { ...state.mapOwners, [id]: actor };
    try { await store.write(state, etag); return; } catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Bitte erneut versuchen.', 409);
}
