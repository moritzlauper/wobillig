import { timingSafeEqual, createHash } from 'node:crypto';
import { InputError } from '../src/community.js';
import { cities, type City } from '../src/cities.js';
import { escapeHtml as e } from '../src/data.js';
import { mapVenueCount, PUBLIC_MAP_MIN_VENUES, type CustomMap } from '../src/custom-map-data.js';
import { mapFingerprint } from './custom-maps.js';
import { WriteConflict, type Store } from './prices.js';

export function authorizedMapReviewer(header: string | undefined): boolean {
  const password = process.env.MAP_REVIEW_PASSWORD;
  if (!password || !header?.startsWith('Basic ')) return false;
  const credentials = Buffer.from(header.slice(6), 'base64').toString();
  const hash = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(hash(credentials), hash(`admin:${password}`));
}
export async function reviewMap(store: Store, id: string, fingerprint: string, approve: boolean, now = Date.now()) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const map = state.customMaps?.find(map => map.id === id);
    if (!map || map.publication?.status !== 'pending' || mapFingerprint(map) !== fingerprint) {
      throw new InputError('Diese Map wurde inzwischen geändert. Bitte neu laden.', 409);
    }
    if (approve && mapVenueCount(map) < PUBLIC_MAP_MIN_VENUES) throw new InputError('Zum Veröffentlichen bitte mindestens einen Ort mit Preis eintragen.', 422);
    map.publication = { ...map.publication, status: approve ? 'approved' : 'rejected', reviewedAt: new Date(now).toISOString(), fingerprint };
    if (approve) map.publishedAt = new Date(now).toISOString();
    else delete map.publishedAt;
    try { await store.write(state, etag); return; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Die Map wird gerade geändert. Bitte erneut versuchen.', 409);
}
export function mapReviewCards(rows: { city: City; map: CustomMap }[]): string {
  const pending = rows.filter(row => row.map.publication?.status === 'pending');
  return pending.map(({ city, map }) => `<article><h2>${e(map.name)}</h2><p>${e(cities[city].name)} · ${mapVenueCount(map)} Orte · <a href="${cities[city].path}?map=${encodeURIComponent(map.id)}" target="_blank" rel="noopener noreferrer">Map ansehen</a></p>
    <div class="scroll"><table><thead><tr><th>Ort / Adresse</th><th>Produkt / Menge</th><th>CHF</th></tr></thead><tbody>${map.entries.map(entry => `<tr><td><strong>${e(entry.venue.name)}</strong><br>${e([entry.venue.address, entry.venue.postcode].filter(Boolean).join(' · '))}${/^(node|way|relation)\/\d+$/.test(entry.venue.id) ? `<br><a href="https://www.openstreetmap.org/${entry.venue.id}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>` : ''}</td><td>${e(entry.product)}</td><td>${entry.priceChf.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>
    <form method="post" action="/api/map-review"><input type="hidden" name="city" value="${city}"><input type="hidden" name="id" value="${e(map.id)}"><input type="hidden" name="fingerprint" value="${mapFingerprint(map)}"><button name="decision" value="approve">Freigeben und veröffentlichen</button><button name="decision" value="reject">Ablehnen</button></form></article>`).join('') || '<p>Keine offenen Einreichungen.</p>';
}
export function mapReviewHtml(rows: { city: City; map: CustomMap }[]): string {
  const pending = rows.filter(row => row.map.publication?.status === 'pending');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Maps prüfen · wobillig</title>
  <style>body{font:16px system-ui;margin:0;background:#f4f5f1;color:#173329}main{max-width:1000px;margin:auto;padding:24px}article{background:white;border:1px solid #ccd8ce;border-radius:8px;padding:20px;margin:20px 0}a{color:#176b4d}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}button{padding:12px;margin:16px 8px 0 0;font:inherit;cursor:pointer}p{line-height:1.5}.scroll{overflow:auto}</style></head><body><main><p>WOBILLIG · PRÜFÜBERSICHT</p><nav aria-label="Prüfbereiche"><a href="/output/price-review/production">Preisänderungen</a> · <strong>Maps zur Freigabe</strong></nav><h1>Maps zur Freigabe</h1><p>${pending.length} Maps warten auf Freigabe. Prüfe Orte, Produkte und Preise vor der Veröffentlichung.</p><a href="/output/price-review/production?view=maps">Aktualisieren</a>
  ${mapReviewCards(rows)}</main></body></html>`;
}
