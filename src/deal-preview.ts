import L from 'leaflet';
import { currentDeal, searchDeals, swissDay, type DealPreview, type Deal } from './deal-data';
import { escapeHtml as e, distance } from './data';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const query = byId<HTMLInputElement>('deal-query'), chain = byId<HTMLSelectElement>('deal-chain');
const category = byId<HTMLSelectElement>('deal-category'), sort = byId<HTMLSelectElement>('deal-sort');
const ending = byId<HTMLInputElement>('deal-ending'), candidates = byId<HTMLInputElement>('deal-candidates');
const map = L.map('deal-map').setView([47.378, 8.535], 12), markers = L.layerGroup().addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
let data: DealPreview | undefined, location: [number, number] | undefined, version = 0, busy = false;
let displayedDay = swissDay(), fitted = false;
const date = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' });
const time = (value?: string) => value ? new Date(value).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' }) : 'Noch kein erfolgreicher Import';
function error(message = '') { byId('error').textContent = message; byId('error').hidden = !message; }
async function load() {
  const request = ++version;
  byId<HTMLButtonElement>('deal-refresh').disabled = true;
  try {
    const response = await fetch('/api/deals', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Vorschau konnte nicht geladen werden.');
    if (request !== version) return;
    data = result; error(); render();
  } catch (cause) {
    if (request === version) { error(cause instanceof Error ? cause.message : 'Vorschau konnte nicht geladen werden.'); if (!data) byId('status').textContent = 'Keine Aktionsdaten geladen.'; }
  } finally { if (request === version) byId<HTMLButtonElement>('deal-refresh').disabled = false; }
}
function distanceFor(offer: Deal) {
  if (!location || !data?.batch) return Infinity;
  const ids = new Set(data.assignments.filter(item => item.offerId === offer.id).map(item => item.branchId));
  return Math.min(Infinity, ...data.batch.branches.filter(b => ids.has(b.id)).map(b => distance(location!, [b.lat, b.lon])));
}
function render() {
  displayedDay = swissDay();
  if (!data) return;
  const batch = data.batch;
  const offers = searchDeals(batch?.offers || [], query.value, chain.value, category.value, ending.checked);
  offers.sort((a, b) => (sort.value === 'price' ? a.priceChf - b.priceChf : sort.value === 'distance' ? distanceFor(a) - distanceFor(b) : a.validThrough.localeCompare(b.validThrough)) || a.product.localeCompare(b.product, 'de-CH'));
  const ids = new Set(offers.map(o => o.id));
  const assignments = data.assignments.filter(item => ids.has(item.offerId));
  byId('status').textContent = `${offers.length} passende Angebote · ${new Set(assignments.map(a => a.branchId)).size} zugeordnete Filialen · Datenstand: ${time(data.lastSuccessAt)}`;
  markers.clearLayers();
  const points: [number, number][] = [];
  for (const branch of batch?.branches || []) {
    if (chain.value && branch.chain !== chain.value || !offers.some(o => o.chain === branch.chain)) continue;
    const matches = assignments.filter(a => a.branchId === branch.id);
    if (!matches.length && !candidates.checked) continue;
    const point: [number, number] = [branch.lat, branch.lon]; points.push(point);
    const marker = L.marker(point, { icon: L.divIcon({ className: `deal-marker${matches.length ? '' : ' candidate'}`,
      html: matches.length ? String(matches.length) : '?', iconSize: [34, 34], iconAnchor: [17, 17] }),
      title: `${branch.name}: ${matches.length ? `${matches.length} zugeordnete Angebote` : 'Filialzuordnung ungeprüft'}` }).addTo(markers);
    const content = document.createElement('div');
    content.innerHTML = `<strong>${e(branch.name)}</strong><p>${e(branch.address)} · ${e(branch.postcode)}</p>
      <p>${matches.length ? `${matches.length} Angebote vom Admin zugeordnet. Lagerbestand unbekannt.` : 'Ungeprüfter Filialkandidat. Keine Gültigkeit dieser Aktionen bestätigt.'}</p>
      <a href="${e(branch.sourceUrl)}" target="_blank" rel="noopener noreferrer">Filiale in OpenStreetMap</a>`;
    for (const match of matches) {
      const offer = offers.find(o => o.id === match.offerId)!;
      const button = document.createElement('button'); button.textContent = `${offer.product} · CHF ${offer.priceChf.toFixed(2)}`;
      button.onclick = () => byId(`offer-${offer.id}`).scrollIntoView({ block: 'center', behavior: 'smooth' });
      content.append(document.createElement('br'), button);
    }
    marker.bindPopup(content);
  }
  if (!fitted && points.length) { map.fitBounds(L.latLngBounds(points), { padding: [25, 25], maxZoom: 14 }); fitted = true; }
  const list = byId('offers'); list.replaceChildren();
  if (!offers.length) {
    list.innerHTML = `<p class="empty">${batch ? 'Keine aktuellen Angebote für diese Auswahl. Abgelaufene und zukünftige Angebote werden nicht angezeigt.' : 'Noch kein Import vorhanden. Der Pilot bleibt privat.'}</p>`;
  }
  for (const offer of offers) {
    const article = document.createElement('article'); article.className = 'deal'; article.id = `offer-${offer.id}`;
    const matches = assignments.filter(a => a.offerId === offer.id);
    article.innerHTML = `<small>${offer.chain === 'coop' ? 'Coop' : 'Migros'} · ${e(offer.quantity)}</small><h2>${e(offer.product)}</h2>
      <p><span class="price">CHF ${offer.priceChf.toFixed(2)}</span><span class="old">${offer.previousPriceChf.toFixed(2)}</span> <small>${e(offer.priceBasis)}</small></p>
      ${offer.unitPrice ? `<p class="meta">CHF ${offer.unitPrice.amount.toFixed(2)} / ${e(offer.unitPrice.unit === 'piece' ? 'Stück' : offer.unitPrice.unit)}</p>` : ''}
      <p class="meta"><strong>${e(offer.conditions)}</strong></p><p class="meta">${date(offer.validFrom)} bis einschliesslich ${date(offer.validThrough)} · Schweizer Zeit</p>
      <p class="meta">${matches.length ? `${matches.length} Filialzuordnungen geprüft` : 'Filialzuordnung noch ungeprüft'}</p>
      ${Number.isFinite(distanceFor(offer)) ? `<p class="meta">Nächste zugeordnete Filiale: ${distanceFor(offer).toFixed(1)} km</p>` : ''}
      <a href="${e(offer.sourceUrl)}#page=${offer.sourcePage}" target="_blank" rel="noopener noreferrer">Originalprospekt · Seite ${offer.sourcePage}</a>
      <details><summary>Beleg und Filialzuordnung prüfen</summary><p class="meta">${e(batch!.source.scopeLabel)}. Eine OSM-Filiale belegt keine Teilnahme an der Aktion.</p><pre>${e(offer.evidence)}</pre><div class="assignments"></div>
      <form><label>Filiale<select name="branchId" required><option value="">Filiale auswählen</option>${batch!.branches.filter(b => b.chain === offer.chain).map(b => `<option value="${e(b.id)}">${e(b.name)} · ${e(b.address)}</option>`).join('')}</select></label>
      <label>Händlerlink mit Beleg<input name="evidenceUrl" type="url" required maxlength="2000" placeholder="https://www.coop.ch/…"></label>
      <label>Warum gilt dieses Angebot in dieser Filiale?<textarea name="evidence" required maxlength="600" rows="2"></textarea></label>
      <button type="submit">Zuordnung für Vorschau bestätigen</button><small>Bleibt ausschliesslich im Adminbereich. Keine Veröffentlichung.</small></form></details>`;
    for (const assignment of matches) {
      const row = document.createElement('div'); row.className = 'assignment';
      const branch = batch!.branches.find(b => b.id === assignment.branchId)!;
      row.innerHTML = `<strong>${e(branch.name)} · ${e(branch.address)}</strong><p>${e(assignment.evidence)}</p><a href="${e(assignment.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Zuordnungsbeleg</a> `;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = 'Zuordnung entfernen';
      remove.onclick = () => void save({ action: 'remove', offerId: offer.id, branchId: assignment.branchId });
      row.append(remove); article.querySelector('.assignments')!.append(row);
    }
    article.querySelector('form')!.onsubmit = event => {
      event.preventDefault();
      const form = new FormData(article.querySelector('form')!);
      void save({ action: 'confirm', offerId: offer.id, branchId: form.get('branchId'), evidence: form.get('evidence'), evidenceUrl: form.get('evidenceUrl') });
    };
    list.append(article);
  }
  const stale = data.lastSuccessAt && Date.now() - Date.parse(data.lastSuccessAt) > 36 * 3600000;
  byId('source-details').innerHTML = `<p><strong>Grün:</strong> geprüfte Zuordnung · <strong>Grau / ?:</strong> ungeprüfte Filiale. Keine bestätigte Warenverfügbarkeit.</p>
    <p>Letzter Abrufversuch: ${e(time(data.lastAttemptAt))}${stale ? ' · Datenstand älter als 36 Stunden' : ''}</p>
    ${data.lastError ? `<p>${e(data.lastError)}</p>` : ''}
    ${batch ? `<p>${e(batch.source.label)} · ${e(batch.source.scopeLabel)}</p><p>${data.expiredCount + batch.offers.filter(o => !currentDeal(o) && o.validThrough < swissDay()).length} abgelaufene und ${data.upcomingCount} zukünftige Angebote ausgeblendet. Kein vollständiges Aktionssortiment.</p>` : ''}
    <p>Filialkandidaten: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> / Photon. Angebote: Originalprospekt des Händlers.</p>`;
}
async function save(input: Record<string, unknown>) {
  if (!data || busy) return;
  busy = true; ++version; error();
  byId('offers').querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
  try {
    const response = await fetch('/api/deals', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, revision: data.revision, fingerprint: data.fingerprint }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Zuordnung konnte nicht gespeichert werden.');
    data = result; render();
  } catch (cause) { error(cause instanceof Error ? cause.message : 'Zuordnung konnte nicht gespeichert werden.'); }
  finally { busy = false; byId('offers').querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; }); byId<HTMLButtonElement>('deal-refresh').disabled = false; }
}
for (const control of [query, chain, category, ending, candidates]) control.addEventListener('input', render);
sort.onchange = () => {
  if (sort.value !== 'distance' || location) { render(); return; }
  if (!navigator.geolocation) { error('Standort nicht verfügbar.'); sort.value = 'ending'; return; }
  navigator.geolocation.getCurrentPosition(position => { location = [position.coords.latitude, position.coords.longitude]; error(); render(); }, () => { error('Standort nicht verfügbar. Sortierung nach Ablaufdatum.'); sort.value = 'ending'; render(); }, { timeout: 10000, maximumAge: 300000 });
};
byId('deal-refresh').onclick = () => { if (!busy) void load(); };
setInterval(() => { if (swissDay() !== displayedDay) render(); }, 1000);
setInterval(() => { if (!busy && !document.hidden && !document.activeElement?.closest('#offers form')) void load(); }, 300000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) { render(); void load(); } });
void load();
