import L from 'leaflet';
import { currentDeal, searchDeals, swissDay, unknownEndDays, wineFilterMatches, wineTypeLabels, type DealPreview, type Deal, type DealBranch } from './deal-data';
import { escapeHtml as e, distance } from './data';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const query = byId<HTMLInputElement>('deal-query'), chain = byId<HTMLSelectElement>('deal-chain');
const category = byId<HTMLSelectElement>('deal-category'), sort = byId<HTMLSelectElement>('deal-sort');
const wine = byId<HTMLSelectElement>('deal-wine'), stock = byId<HTMLSelectElement>('deal-stock');
const ending = byId<HTMLInputElement>('deal-ending'), candidates = byId<HTMLInputElement>('deal-candidates');
const map = L.map('deal-map').setView([47.378, 8.535], 12), markers = L.layerGroup().addTo(map);
// The page sends no-referrer for privacy. Tiles still send the origin, which OpenStreetMap's tile policy asks for.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
let data: DealPreview | undefined, location: [number, number] | undefined, version = 0, busy = false;
let displayedDay = swissDay(), fitted = false, selected: string | undefined, sweepSeen = false;
const phone = matchMedia('(max-width: 760px)');
const date = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' });
const time = (value?: string) => value ? new Date(value).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' }) : 'Noch kein erfolgreicher Import';
const discount = (offer: Deal) => Math.round(100 * (1 - offer.priceChf / offer.previousPriceChf));
// Store promotions the store search finds in no branch (mostly six-bottle cartons) can only be ordered online.
const onlineOnly = (offer: Deal) => offer.onlineOnly || offer.availableAt?.length === 0;
function error(message = '') { byId('error').textContent = message; byId('error').hidden = !message; }
async function load() {
  const request = ++version;
  byId<HTMLButtonElement>('deal-refresh').disabled = true;
  try {
    const response = await fetch('/api/deals', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Vorschau konnte nicht geladen werden.');
    if (request !== version) return;
    data = result; error();
    // With branches from the retailer's store search, OSM candidates only duplicate the same shops.
    if (data?.sweep?.branches.length && !sweepSeen) { sweepSeen = true; candidates.checked = false; }
    render();
  } catch (cause) {
    if (request === version) { error(cause instanceof Error ? cause.message : 'Vorschau konnte nicht geladen werden.'); if (!data) byId('status').textContent = 'Keine Aktionsdaten geladen.'; }
  } finally { if (request === version) byId<HTMLButtonElement>('deal-refresh').disabled = false; }
}
// Branches where an offer applies: reviewed assignments for brochure offers, the store search for shop offers.
function branchesFor(offer: Deal) {
  if (!data) return new Set<string>();
  return new Set([...data.assignments.filter(item => item.offerId === offer.id).map(item => item.branchId), ...offer.availableAt || []]);
}
function distanceFor(offer: Deal, branches: DealBranch[]) {
  if (!location) return Infinity;
  const ids = branchesFor(offer);
  return Math.min(Infinity, ...branches.filter(b => ids.has(b.id)).map(b => distance(location!, [b.lat, b.lon])));
}
function validity(offer: Deal) {
  if (offer.endUnknown) return `Am ${date(offer.validThrough)} auf coop.ch als Aktion gelistet · Enddatum nicht veröffentlicht · ausgeblendet nach ${unknownEndDays} Tagen ohne neuen Abgleich`;
  return `${date(offer.validFrom)} bis einschliesslich ${date(offer.validThrough)} · Schweizer Zeit${offer.brochure ? ` · laut Prospekt Seite ${offer.brochure.page}` : ''}`;
}
function render() {
  displayedDay = swissDay();
  if (!data) return;
  const batch = data.batch, sweep = data.sweep;
  const sweepOffers = sweep?.offers || [];
  // A brochure offer that the shop sweep matched to the same page and prices is shown once, with shop data.
  const duplicate = (offer: Deal) => sweepOffers.some(other => other.brochure?.page === offer.sourcePage && other.priceChf === offer.priceChf && other.previousPriceChf === offer.previousPriceChf);
  const branches = [...sweep?.branches || [], ...batch?.branches || []];
  if (selected && !branches.some(b => b.id === selected)) selected = undefined;
  let offers = searchDeals([...(batch?.offers || []).filter(offer => !duplicate(offer)), ...sweepOffers], query.value, chain.value, category.value, ending.checked);
  offers = offers.filter(offer => wineFilterMatches(offer, wine.value) &&
    (stock.value !== 'branch' || branchesFor(offer).size > 0) && (stock.value !== 'online' || onlineOnly(offer)) &&
    (!selected || branchesFor(offer).has(selected)));
  const unit = (offer: Deal) => offer.unitPrice?.unit === 'l' ? offer.unitPrice.amount : Infinity;
  offers.sort((a, b) => (sort.value === 'price' ? a.priceChf - b.priceChf : sort.value === 'discount' ? discount(b) - discount(a) :
    sort.value === 'litre' ? unit(a) - unit(b) : sort.value === 'distance' ? distanceFor(a, branches) - distanceFor(b, branches) :
    Number(Boolean(a.endUnknown)) - Number(Boolean(b.endUnknown)) || a.validThrough.localeCompare(b.validThrough)) || a.product.localeCompare(b.product, 'de-CH'));
  const ids = new Set(offers.map(o => o.id));
  const assignments = data.assignments.filter(item => ids.has(item.offerId));
  const counts = new Map<string, Deal[]>();
  for (const offer of offers) for (const id of branchesFor(offer)) counts.set(id, [...counts.get(id) || [], offer]);
  const sources = [batch && `Prospekt ${time(data.lastSuccessAt)}`, sweep && `coop.ch-Sweep ${time(sweep.source.fetchedAt)}`].filter(Boolean).join(' · ');
  byId('status').textContent = `${offers.length} passende Angebote · ${counts.size} Filialen mit passenden Angeboten · Datenstand: ${sources || time(data.lastSuccessAt)}`;
  const branch = branches.find(b => b.id === selected);
  byId('deal-selected').hidden = !branch;
  byId('deal-selected-name').textContent = branch ? `Filiale: ${branch.name}` : '';
  markers.clearLayers();
  const points: [number, number][] = [];
  for (const branch of branches) {
    const matches = counts.get(branch.id) || [], shop = branch.id.startsWith('coop/');
    if (chain.value && branch.chain !== chain.value) continue;
    if (!shop && !matches.length && !candidates.checked) continue;
    const point: [number, number] = [branch.lat, branch.lon], size = phone.matches ? 26 : 34; points.push(point);
    const marker = L.marker(point, { icon: L.divIcon({ className: `deal-marker${matches.length ? '' : shop ? ' none' : ' candidate'}${branch.id === selected ? ' selected' : ''}`,
      html: matches.length ? String(matches.length) : shop ? '0' : '?', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
      title: `${branch.name}: ${matches.length ? `${matches.length} passende Angebote` : shop ? 'keine passenden Angebote' : 'Filialzuordnung ungeprüft'}` }).addTo(markers);
    const content = document.createElement('div');
    content.innerHTML = `<strong>${e(branch.name)}</strong><p>${e(branch.address)} · ${e(branch.postcode)}</p>
      <p>${shop ? `${matches.length} passende Aktionen laut coop.ch-Filialsuche verfügbar. Ohne Gewähr, Filialpreise können abweichen.`
        : matches.length ? `${matches.length} Angebote vom Admin zugeordnet. Lagerbestand unbekannt.` : 'Ungeprüfter Filialkandidat. Keine Gültigkeit dieser Aktionen bestätigt.'}</p>
      <a href="${e(branch.sourceUrl)}" target="_blank" rel="noopener noreferrer">${shop ? 'Filiale auf coop.ch' : 'Filiale in OpenStreetMap'}</a>`;
    if (matches.length) {
      const only = document.createElement('button'); only.type = 'button'; only.textContent = branch.id === selected ? 'Alle Filialen zeigen' : 'Nur Angebote dieser Filiale';
      only.onclick = () => { selected = branch.id === selected ? undefined : branch.id; map.closePopup(); render(); };
      content.append(document.createElement('br'), only);
    }
    // Keeps the popup clear of the zoom buttons on small maps.
    marker.bindPopup(content, { maxWidth: 260, autoPanPaddingTopLeft: L.point(48, 12) });
  }
  if (!fitted && points.length) { map.fitBounds(L.latLngBounds(points), { padding: [25, 25], maxZoom: 14 }); fitted = true; }
  const list = byId('offers'); list.replaceChildren();
  if (!offers.length) {
    list.innerHTML = `<p class="empty">${batch || sweep ? 'Keine aktuellen Angebote für diese Auswahl. Abgelaufene und zukünftige Angebote werden nicht angezeigt.' : 'Noch kein Import vorhanden. Der Pilot bleibt privat.'}</p>`;
  }
  const total = sweep?.branches.length || 0;
  for (const offer of offers.slice(0, 200)) {
    const article = document.createElement('article'); article.className = 'deal'; article.id = `offer-${offer.id}`;
    const nearest = distanceFor(offer, branches), shop = offer.sourcePage === undefined;
    const kind = [offer.chain === 'coop' ? 'Coop' : 'Migros', offer.quantity, offer.wineType && wineTypeLabels[offer.wineType], offer.natural && 'Naturwein', offer.origin].filter(Boolean).join(' · ');
    article.innerHTML = `<small>${e(kind)}</small><h2>${e(offer.product)}</h2>
      <p><span class="price">CHF ${offer.priceChf.toFixed(2)}</span><span class="old">${offer.previousPriceChf.toFixed(2)}</span> <small>${e(offer.priceBasis)} · −${discount(offer)}%</small></p>
      ${offer.unitPrice ? `<p class="meta">CHF ${offer.unitPrice.amount.toFixed(2)} / ${e(offer.unitPrice.unit === 'piece' ? 'Stück' : offer.unitPrice.unit)}</p>` : ''}
      <p class="meta"><strong>${e(offer.conditions)}</strong></p><p class="meta">${e(validity(offer))}</p>
      <p class="meta">${offer.onlineOnly ? '<span class="tag">Nur online</span>' : onlineOnly(offer) ? '<span class="tag">Nur online</span> Laut coop.ch-Filialsuche in keiner Zürcher Filiale erhältlich' : shop ? (offer.availableAt ? `In ${offer.availableAt.length} von ${total} Zürcher Filialen verfügbar (coop.ch-Filialsuche, ohne Gewähr)${selected ? ' · auch in der gewählten Filiale' : ''}` : 'Filialverfügbarkeit nicht geprüft')
        : branchesFor(offer).size ? `${branchesFor(offer).size} Filialzuordnungen geprüft` : 'Filialzuordnung noch ungeprüft'}</p>
      ${Number.isFinite(nearest) ? `<p class="meta">Nächste Filiale mit diesem Angebot: ${nearest.toFixed(1)} km</p>` : ''}
      ${shop ? `<a href="${e(offer.sourceUrl)}" target="_blank" rel="noopener noreferrer">Produktseite auf coop.ch</a>${offer.brochure ? ` · <a href="${e(offer.brochure.url)}" target="_blank" rel="noopener noreferrer">Prospekt · Seite ${offer.brochure.page}</a>` : ''}
        <details><summary>Beleg</summary><p class="meta">${e(sweep!.source.scopeLabel)}.</p><pre>${e(offer.evidence)}</pre></details>`
      : `<a href="${e(offer.sourceUrl)}#page=${offer.sourcePage}" target="_blank" rel="noopener noreferrer">Originalprospekt · Seite ${offer.sourcePage}</a>
      <details><summary>Beleg und Filialzuordnung prüfen</summary><p class="meta">${e(batch!.source.scopeLabel)}. Eine OSM-Filiale belegt keine Teilnahme an der Aktion.</p><pre>${e(offer.evidence)}</pre><div class="assignments"></div>
      <form><label>Filiale<select name="branchId" required><option value="">Filiale auswählen</option>${batch!.branches.filter(b => b.chain === offer.chain).map(b => `<option value="${e(b.id)}">${e(b.name)} · ${e(b.address)}</option>`).join('')}</select></label>
      <label>Händlerlink mit Beleg<input name="evidenceUrl" type="url" required maxlength="2000" placeholder="https://www.coop.ch/…"></label>
      <label>Warum gilt dieses Angebot in dieser Filiale?<textarea name="evidence" required maxlength="600" rows="2"></textarea></label>
      <button type="submit">Zuordnung für Vorschau bestätigen</button><small>Bleibt ausschliesslich im Adminbereich. Keine Veröffentlichung.</small></form></details>`}`;
    if (!shop) {
      for (const assignment of assignments.filter(a => a.offerId === offer.id)) {
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
    }
    list.append(article);
  }
  if (offers.length > 200) list.insertAdjacentHTML('beforeend', `<p class="empty">${offers.length - 200} weitere Angebote. Suche oder Filter eingrenzen.</p>`);
  const stale = data.lastSuccessAt && Date.now() - Date.parse(data.lastSuccessAt) > 36 * 3600000;
  byId('source-details').innerHTML = `<p><strong>Zahl im Kreis:</strong> passende Angebote in dieser Filiale · <strong>0:</strong> coop.ch-Filiale ohne passende Angebote · <strong>?:</strong> ungeprüfter OSM-Kandidat. Keine bestätigte Warenverfügbarkeit.</p>
    <p>Letzter Abrufversuch Prospekt: ${e(time(data.lastAttemptAt))}${stale ? ' · Datenstand älter als 36 Stunden' : ''}</p>
    ${data.lastError ? `<p>${e(data.lastError)}</p>` : ''}
    ${batch ? `<p>${e(batch.source.label)} · ${e(batch.source.scopeLabel)}</p><p>${data.expiredCount + batch.offers.filter(o => !currentDeal(o) && o.validThrough < swissDay()).length} abgelaufene und ${data.upcomingCount} zukünftige Angebote ausgeblendet. Kein vollständiges Aktionssortiment.</p>` : ''}
    ${sweep ? `<p>${e(sweep.source.label)} · ${e(sweep.source.scopeLabel)} · ${sweep.offers.length} aktuelle Angebote, ${sweep.branches.length} Filialen in der Stadt Zürich · Abruf ${e(time(sweep.source.fetchedAt))}. Manuell im Browser erhoben, Crawl-Delay gemäss robots.txt.</p>` : ''}
    <p>Filialkandidaten: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> / Photon. Angebote: Originalprospekt und coop.ch.</p>`;
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
for (const control of [query, chain, category, wine, stock, ending, candidates]) control.addEventListener('input', render);
phone.addEventListener('change', render);
byId('deal-selected-clear').onclick = () => { selected = undefined; render(); };
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
