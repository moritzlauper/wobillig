import { InputError } from '../src/community.js';
import { cities, type City } from '../src/cities.js';
import { escapeHtml as e } from '../src/data.js';
import { automaticMapStatusLabels, type AutomaticMapRequest, type CustomMap } from '../src/custom-map-data.js';
import { WriteConflict, type Store } from './prices.js';

export async function reviewAutomaticMap(store: Store, id: string, revision: number,
  status: AutomaticMapRequest['status'], note: string, now = Date.now()) {
  if (!['reviewing', 'blocked', 'rejected'].includes(status) || !Number.isSafeInteger(revision) || revision < 1 ||
    typeof note !== 'string' || note.length > 600 || /[\x00-\x1f\x7f]/.test(note) || (status !== 'reviewing' && !note.trim())) {
    throw new InputError('Bitte einen gültigen Status und bei Rückstellung oder Ablehnung eine kurze Begründung eingeben.');
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const map = state.customMaps?.find(map => map.id === id);
    if (!map?.automatic || map.automatic.revision !== revision) throw new InputError('Diese Map wurde inzwischen geändert. Bitte neu laden.', 409);
    map.automatic = { ...map.automatic, status, note: note.trim(), revision: revision + 1, reviewedAt: new Date(now).toISOString() };
    try { await store.write(state, etag); return; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Die Map wird gerade geändert. Bitte erneut versuchen.', 409);
}

export function automaticMapReviewCards(rows: { city: City; map: CustomMap }[]) {
  const requests = rows.filter(row => row.map.automatic).sort((a, b) => b.map.createdAt.localeCompare(a.map.createdAt));
  return `<section id="automatic-map-review" aria-labelledby="automatic-map-heading"><h2 id="automatic-map-heading">Automatische Maps</h2>
    <p>${requests.length} Anfragen · Quellen werden erst nach technischer Prüfung angebunden. Eine Statusänderung startet keinen Scraper und veröffentlicht keine Angebote.</p>
    ${requests.map(({ city, map }) => {
      const request = map.automatic!;
      return `<article class="automatic-map-request"><h3>${e(map.name)}</h3>
        <p>${e(cities[city].name)} · <strong>${e(automaticMapStatusLabels[request.status])}</strong> · ${e(new Date(map.createdAt).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }))}</p>
        <p><a href="${e(request.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(request.sourceUrl)}</a></p>
        <p>${e(request.description)}</p>
        <p><a href="${cities[city].path}?map=${encodeURIComponent(map.id)}" target="_blank" rel="noopener noreferrer">Anfrage ansehen</a></p>
        <form method="post" action="/api/map-review">
          <input type="hidden" name="kind" value="automatic"><input type="hidden" name="city" value="${city}">
          <input type="hidden" name="id" value="${e(map.id)}"><input type="hidden" name="revision" value="${request.revision}">
          <label>Status<select name="decision"><option value="reviewing"${request.status === 'reviewing' || request.status === 'requested' ? ' selected' : ''}>In Prüfung nehmen</option><option value="blocked"${request.status === 'blocked' ? ' selected' : ''}>Quelle noch nicht verfügbar</option><option value="rejected"${request.status === 'rejected' ? ' selected' : ''}>Ablehnen</option></select></label>
          <label>Rückmeldung (für alle mit dem Anfragelink sichtbar)<input name="note" maxlength="600" value="${e(request.note || '')}" placeholder="Zum Beispiel: Quelle blockiert automatische Abrufe."></label>
          <button type="submit">Status speichern</button>
        </form></article>`;
    }).join('') || '<p>Noch keine automatischen Maps angefragt.</p>'}</section>`;
}
