import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { coverageLabel, missingPriceLabel } from './coverage';
import { bestOffer, matchingOffers, isCurrentOffer, coffeeLabels, portion, effectiveBeerType, beerTypeLabel, beerTypeLabels, cost, escapeHtml as e, filterBars, safeUrl, type Bar, type Dataset, type Filters, type BeerType, type Offer } from './data';
import { allVenues, applyEntries, offerKey, validateInput, zurichToday, type Drink, type PriceEntry, type PriceInput } from './community';
import { barLink, shareLink } from './sharing';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => n.toFixed(2);
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => `<option value="${value}">${e(label)}</option>`).join('');
const coffeeOptions = options(coffeeLabels);
const initial = new URLSearchParams(location.search);
const f: Filters = { drink: initial.get('drink') === 'coffee' ? 'coffee' : 'beer', coffeeType: 'creme', beerType: 'all', query: '', max: 15, volume: initial.get('size') === 'stange' ? 'stange' : '500', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' };
const datasets: Partial<Record<Drink, Dataset>> = {};
let entries: PriceEntry[] = [], venues: Bar[] = [], bars: Bar[] = [], current: Bar[] = [];
let selected: string | undefined, position: [number, number] | undefined, editing: Offer | undefined;
let communityReady = false, saving = false;
let userMarker: L.CircleMarker | undefined;
const coffee = () => f.drink === 'coffee';
const unit = (o: Offer) => o.coffeeType ? portion(o) : `${f.mode === 'half' ? `5 dl${o.volumeMl === 500 ? '' : ' · umgerechnet'}` : portion(o)} · ${beerTypeLabel(o)}`;

$('app').innerHTML = `
<div class="toolbar">
  <div class="switch" role="group" aria-label="Getränk"><button id="drink-beer">Bier</button><button id="drink-coffee">Kaffee</button></div>
  <input id="search" type="search" placeholder="Lokal, Strasse, PLZ" aria-label="Lokal suchen">
  <select id="volume" aria-label="Biergrösse">${options({ '500': '5 dl', stange: 'Stange / 3 dl', '300': 'Genau 3 dl', '330': '3.3 dl', '400': '4 dl', all: 'Alle Grössen' })}</select>
  <select id="coffeeType" aria-label="Kaffeesorte" hidden><option value="all">Alle Kaffees</option>${coffeeOptions}</select>
  <label class="budget">Bis CHF <input id="price" aria-label="Höchstpreis in CHF" type="number" min="0.5" max="50" step="0.5" value="15"></label>
  <button id="filters-toggle" aria-expanded="false" aria-controls="filters">Filter</button>
  <button id="new-price" class="primary" disabled>Preis eintragen</button>
</div>
<div id="filters" hidden>
  <label>Lokal <select id="type">${options({ '': 'Alle', bar: 'Bar', pub: 'Pub', biergarten: 'Biergarten', restaurant: 'Restaurant', cafe: 'Café' })}</select></label>
  <label><input id="unknown" type="checkbox" checked> Ohne passenden Preis anzeigen</label>
  <label><input id="outdoor" type="checkbox"> Draussen sitzen</label>
  <label id="beer-type-label">Ausschank<select id="beer-type">${options({ all: 'Alle', ...beerTypeLabels })}</select></label>
  <label id="alcohol-label"><input id="alcohol-free" type="checkbox"> Alkoholfrei</label>
  <label id="normalize-label"><input id="normalize" type="checkbox"> Auf 5 dl umrechnen</label>
  <button id="reset">Zurücksetzen</button>
</div>
<div class="status-row"><span id="count" role="status">Laden …</span><div class="mobile-switch" role="group" aria-label="Ansicht"><button id="view-map" aria-pressed="true">Karte</button><button id="view-list" aria-pressed="false">Liste</button></div><button id="data-info" class="text-button">Daten</button></div>
<div id="load-error" role="status" hidden></div>
<main>
  <aside class="list-panel" aria-label="Lokale"><div class="list-tools"><select id="sort" aria-label="Sortierung">${options({ price: 'Preis aufsteigend', price_desc: 'Preis absteigend', name: 'Name A–Z', distance: 'Entfernung' })}</select></div><div id="results"></div></aside>
  <section class="map-panel" aria-label="Karte"><div id="map"></div><div class="map-actions"><button id="locate">Standort</button><button id="fit">Alle anzeigen</button></div><div id="map-unit" class="map-unit"></div><section id="detail" aria-label="Lokal und Preise" tabindex="-1" hidden></section></section>
</main>
<div id="toast" role="status" hidden></div>
<dialog id="share-dialog" aria-labelledby="share-title"><div class="dialog-top"><strong id="share-title">Lokal teilen</strong><button id="close-share" type="button">Schliessen</button></div><label for="share-url">Diesen Link kopieren und teilen:</label><input id="share-url" type="url" readonly></dialog>
<dialog id="price-dialog" aria-label="Preis eintragen"><form id="price-form">
  <div class="dialog-top"><strong id="form-title">Preis eintragen</strong><button id="cancel-price" type="button">Schliessen</button></div>
  <label>Lokal<select id="entry-bar" required></select></label>
  <div class="form-row"><label>Getränk<select id="entry-drink"><option value="beer">Bier</option><option value="coffee">Kaffee</option></select></label><label id="entry-coffee-label" hidden>Sorte<select id="entry-coffee">${coffeeOptions}</select></label></div>
  <label>Bezeichnung<input id="entry-name" maxlength="100" placeholder="z. B. Lager oder Espresso" required></label>
  <div id="entry-beer-fields"><label>Ausschank<select id="entry-beer-type">${options(beerTypeLabels)}</select></label><small id="entry-type-hint" class="muted" hidden>Diese Vorauswahl ist geschätzt. Bitte prüfen.</small><div class="form-row"><label>Menge in dl<input id="entry-volume" type="number" min="1" max="10" step="0.01" value="5"></label><label class="inline-check"><input id="entry-stange" type="checkbox"> Stange</label></div><label class="check"><input id="entry-size-unknown" type="checkbox"> Menge nicht angegeben (nur Stange)</label><label class="check"><input id="entry-alcohol" type="checkbox"> Alkoholfrei</label></div>
  <div class="form-row"><label>Preis in CHF<input id="entry-price" type="number" min="0.5" max="50" step="0.01" inputmode="decimal" required></label><label>Preis gesehen am<input id="entry-date" type="date" min="2020-01-01" required></label></div>
  <label>Link zur Karte (optional)<input id="entry-source" type="url" maxlength="1500" placeholder="https://…"></label>
  <p class="muted">Wird für alle sichtbar. Bitte den tatsächlichen Preis dieser Portion eintragen.</p>
  <p id="form-error" role="alert" hidden></p><button id="save-price" class="primary" type="submit">Speichern</button>
</form></dialog>
<dialog id="info" aria-label="Daten"><div class="dialog-top"><strong>Daten</strong><button id="close-info">Schliessen</button></div><p id="coverage"></p><p>Preise stammen aus verlinkten Getränkekarten oder wurden von Besuchern eingetragen. Eingetragene Preise sind nicht geprüft. Quelle, Menge und Datum stehen beim Angebot.</p><p>Stange: 3 dl oder ausdrücklich als Stange bezeichnete kleine Portion; bekannte Flaschen und Dosen sind ausgeschlossen. Fehlt die Ausschankart in der Quelle, wird sie anhand von Menü, Bezeichnung und Menge geschätzt. Solche Angaben sind als «geschätzt» gekennzeichnet und zählen im Ausschank-Filter mit. Fehlende Mengen bleiben offen. Die optionale Umrechnung auf 5 dl ist ein Vergleichspreis.</p><p>Neue Einträge und Korrekturen werden gemeinsam gespeichert. Zum Begrenzen von Spam wird kurzzeitig eine nicht rücklesbare Kennung aus der IP-Adresse gespeichert. Dein Standort bleibt im Browser.</p><p>Standorte und Karte: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap-Mitwirkende, ODbL</a>.</p></dialog>`;

const map = L.map('map', { zoomControl: false }).setView([47.378, 8.535], 14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
new ResizeObserver(() => map.invalidateSize()).observe($('map'));
const layer = L.layerGroup().addTo(map);
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function showView(list: boolean) {
  document.body.classList.toggle('show-list', list);
  $('view-map').setAttribute('aria-pressed', String(!list)); $('view-list').setAttribute('aria-pressed', String(list));
  map.invalidateSize();
}
function rebuild() {
  const base = datasets[f.drink!];
  bars = base ? applyEntries(base, entries, venues, f.drink!).bars : [];
  render();
}
function syncControls() {
  $('volume').hidden = coffee(); $('coffeeType').hidden = !coffee();
  $('beer-type-label').hidden = coffee(); $<HTMLSelectElement>('beer-type').value = f.beerType || 'all';
  $('alcohol-label').hidden = coffee(); $('normalize-label').hidden = coffee() || ['stange', '300'].includes(f.volume);
  $<HTMLSelectElement>('volume').value = f.volume;
  $<HTMLSelectElement>('coffeeType').value = f.coffeeType!;
  $<HTMLInputElement>('normalize').checked = f.mode === 'half';
  for (const drink of ['beer', 'coffee']) $('drink-' + drink).setAttribute('aria-pressed', String(f.drink === drink));
  const url = new URL(location.href);
  if (coffee()) url.searchParams.set('drink', 'coffee'); else url.searchParams.delete('drink');
  if (!coffee() && f.volume === 'stange') url.searchParams.set('size', 'stange'); else url.searchParams.delete('size');
  if (selected) url.searchParams.set('bar', selected); else url.searchParams.delete('bar');
  history.replaceState(null, '', url);
}
function render() {
  syncControls();
  current = filterBars(bars, f, position);
  $('count').textContent = coverageLabel(current, f);
  $('map-unit').textContent = coffee() ? `CHF · ${f.coffeeType === 'all' ? 'pro Getränk' : coffeeLabels[f.coffeeType!]}` : f.mode === 'half' ? 'CHF / 5 dl · umgerechnet' : f.volume === 'all' ? 'CHF / Portion · Menge beachten' : f.volume === 'stange' ? 'CHF / Stange' : `CHF / ${Number(f.volume) / 100} dl`;
  $('results').innerHTML = current.length ? current.map(b => {
    const o = bestOffer(b, f);
    return `<button class="venue ${selected === b.id ? 'selected' : ''}" data-bar="${e(b.id)}"><span><strong>${e(b.name)}</strong><small>${e(b.address || b.postcode || 'Zürich')}</small>${o ? `<small>${e(unit(o))}</small>` : ''}</span><span class="venue-price">${o ? money(cost(o, f.mode)) : `<small>${missingPriceLabel(b, f)}</small>`}</span></button>`;
  }).join('') : '<p class="empty">Keine passenden Lokale.</p>';
  layer.clearLayers();
  const selectedBar = bars.find(b => b.id === selected);
  const mapped = selectedBar && !current.includes(selectedBar) ? [...current, selectedBar] : current;
  for (const b of mapped) {
    const o = bestOffer(b, f);
    const label = `${b.name}: ${o ? `CHF ${money(cost(o, f.mode))} / ${unit(o)}` : 'kein passender Preis'}`;
    L.marker([b.lat, b.lon], {
      icon: L.divIcon({ className: 'marker-wrap', html: `<span class="price-marker ${o ? '' : 'unknown'} ${b.id === selected ? 'active' : ''}">${o ? money(cost(o, f.mode)) : '·'}</span>`, iconSize: o ? [54, 26] : [14, 14], iconAnchor: o ? [27, 13] : [7, 7] }),
      title: label, alt: label, zIndexOffset: b.id === selected ? 2000 : o ? 1000 : 0,
    }).addTo(layer).on('click', () => showBar(b));
  }
  $('results').querySelectorAll<HTMLButtonElement>('[data-bar]').forEach(button => button.onclick = () => showBar(bars.find(b => b.id === button.dataset.bar)!));
  if (selectedBar) detail(selectedBar); else $('detail').hidden = true;
}
function detail(b: Bar) {
  const matches = matchingOffers(b, f);
  const other = b.offers.filter(o => isCurrentOffer(o) && !matches.includes(o));
  const offers = [...matches, ...other];
  $('detail').innerHTML = `<div class="detail-top"><strong>${e(b.name)}</strong><button id="close-detail">Schliessen</button></div><p class="muted">${e([b.address, b.postcode].filter(Boolean).join(' '))}</p><div class="detail-actions"><button id="add-here">Preis hinzufügen</button><button id="share-bar" aria-label="${e(b.name)} teilen">Teilen</button></div>${offers.length ? offers.map((o, i) => `<div class="offer ${matches.includes(o) ? '' : 'other-offer'}"><div class="offer-top"><strong>${e(o.name)}</strong><strong class="nowrap">CHF ${money(o.priceChf)}</strong></div><div class="muted">${e(portion(o))}${!o.coffeeType ? ' · ' + e(beerTypeLabels[effectiveBeerType(o)]) : ''}${!o.coffeeType && o.alcoholFree ? ' · alkoholfrei' : ''}${!matches.includes(o) ? ' · ausserhalb Filter' : ''}</div>${!o.coffeeType && o.beerTypeEstimate && (!o.beerType || o.beerType === 'unknown') ? `<details class="estimate muted"><summary>geschätzt</summary><p>${e(o.beerTypeEstimate.reason)}</p></details>` : ''}<div class="offer-meta"><span>${o.photoSource ? `Google-Maps-Foto · ${e(o.photoSource.date)} · ` : ''}${o.confidence === 'community' ? 'Eingetragen · nicht geprüft' : o.confidence === 'reviewed' ? 'Manuell geprüft' : o.confidence === 'ai' ? 'KI-erkannt · nicht geprüft' : 'Automatisch erkannt'} · ${e(new Date(o.observedAt).toLocaleDateString('de-CH'))}</span>${safeUrl(o.sourceUrl) ? `<a href="${safeUrl(o.sourceUrl)}" target="_blank" rel="noopener noreferrer">Quelle</a>` : ''}<button data-edit="${i}">Ändern</button></div></div>`).join('') : '<p>Noch kein Preis eingetragen.</p>'}${safeUrl(b.website) ? `<p><a href="${safeUrl(b.website)}" target="_blank" rel="noopener noreferrer">Website</a></p>` : ''}`;
  $('detail').hidden = false;
  $('close-detail').onclick = () => { selected = undefined; render(); };
  $('add-here').onclick = () => openPrice(b);
  $('share-bar').onclick = async () => {
    const button = $<HTMLButtonElement>('share-bar');
    const url = barLink(location.href, b.id, f.drink!, f.volume);
    button.disabled = true;
    try {
      const result = await shareLink({ title: `${b.name} · wogünstig`, url });
      if (result === 'copied') toast('Link kopiert.');
      if (result === 'manual') {
        $<HTMLInputElement>('share-url').value = url;
        $<HTMLDialogElement>('share-dialog').showModal();
        $<HTMLInputElement>('share-url').focus();
        $<HTMLInputElement>('share-url').select();
      }
    } finally { button.disabled = false; }
  };
  $('detail').querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button => button.onclick = () => openPrice(b, offers[Number(button.dataset.edit)]));
}
function showBar(b: Bar) { selected = b.id; showView(false); map.setView([b.lat, b.lon], Math.max(map.getZoom(), 15)); render(); $('detail').focus({ preventScroll: true }); }
function chooseDrink(drink: Drink) { f.drink = drink; f.mode = 'glass'; selected = undefined; rebuild(); }
$('drink-beer').onclick = () => chooseDrink('beer'); $('drink-coffee').onclick = () => chooseDrink('coffee');
$('view-map').onclick = () => showView(false); $('view-list').onclick = () => showView(true);
$('search').oninput = () => { f.query = $<HTMLInputElement>('search').value; render(); };
$('price').oninput = () => { const n = $<HTMLInputElement>('price').valueAsNumber; f.max = Number.isFinite(n) ? n : Infinity; render(); };
$('volume').onchange = () => { f.volume = $<HTMLSelectElement>('volume').value; if (['stange', '300'].includes(f.volume)) f.mode = 'glass'; render(); };
$('coffeeType').onchange = () => { f.coffeeType = $<HTMLSelectElement>('coffeeType').value; render(); };
$('beer-type').onchange = () => { f.beerType = $<HTMLSelectElement>('beer-type').value as Filters['beerType']; render(); };
$('type').onchange = () => { f.type = $<HTMLSelectElement>('type').value; render(); };
$('sort').onchange = () => { f.sort = $<HTMLSelectElement>('sort').value; if (f.sort === 'distance' && !position) locate(); else render(); };
for (const [id, key] of [['unknown', 'unknown'], ['outdoor', 'outdoor'], ['alcohol-free', 'alcoholFree']] as const) $(id).onchange = () => { f[key] = $<HTMLInputElement>(id).checked; render(); };
$('normalize').onchange = () => { f.mode = $<HTMLInputElement>('normalize').checked ? 'half' : 'glass'; render(); };
$('filters-toggle').onclick = () => { $('filters').hidden = !$('filters').hidden; $('filters-toggle').setAttribute('aria-expanded', String(!$('filters').hidden)); };
$('reset').onclick = () => {
  Object.assign(f, { query: '', max: 15, volume: '500', coffeeType: 'creme', beerType: 'all', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' });
  $<HTMLInputElement>('search').value = ''; $<HTMLInputElement>('price').value = '15';
  $<HTMLSelectElement>('type').value = ''; $<HTMLSelectElement>('sort').value = 'price';
  for (const id of ['unknown', 'outdoor', 'alcohol-free']) $<HTMLInputElement>(id).checked = id === 'unknown';
  render();
};
function locate() {
  if (!navigator.geolocation) return toast('Standort wird von diesem Browser nicht unterstützt.');
  navigator.geolocation.getCurrentPosition(p => {
    position = [p.coords.latitude, p.coords.longitude];
    userMarker?.remove(); userMarker = L.circleMarker(position, { radius: 7, color: '#fff', fillColor: '#1766c2', fillOpacity: 1, weight: 2 }).addTo(map);
    map.setView(position, 15); render();
  }, () => { if (f.sort === 'distance') { f.sort = 'price'; $<HTMLSelectElement>('sort').value = 'price'; } toast('Standort nicht verfügbar.'); }, { timeout: 10000 });
}
$('locate').onclick = locate;
$('fit').onclick = () => { if (current.length) map.fitBounds(L.latLngBounds(current.map(b => [b.lat, b.lon])), { padding: [35, 35], maxZoom: 16 }); };
$('data-info').onclick = () => {
  $('coverage').textContent = Object.entries(datasets).map(([drink, data]) => `${drink === 'beer' ? 'Bier' : 'Kaffee'}: ${data.bars.reduce((n, b) => n + b.offers.length, 0)} Angebote aus Karten bei ${data.bars.filter(b => b.offers.length).length} Lokalen`).join('. ') + `. ${entries.length} gemeinsame Einträge/Korrekturen.`;
  $<HTMLDialogElement>('info').showModal();
};
$('close-info').onclick = () => $<HTMLDialogElement>('info').close();
$('close-share').onclick = () => $<HTMLDialogElement>('share-dialog').close();
$('share-url').onclick = () => $<HTMLInputElement>('share-url').select();

function entryFields() {
  const isCoffee = $<HTMLSelectElement>('entry-drink').value === 'coffee';
  const packaged = ['bottle', 'can'].includes($<HTMLSelectElement>('entry-beer-type').value);
  if (packaged) { $<HTMLInputElement>('entry-stange').checked = false; $<HTMLInputElement>('entry-size-unknown').checked = false; }
  $<HTMLInputElement>('entry-size-unknown').disabled = packaged;
  const unknown = $<HTMLInputElement>('entry-size-unknown').checked;
  $('entry-coffee-label').hidden = !isCoffee; $('entry-beer-fields').hidden = isCoffee;
  $<HTMLInputElement>('entry-volume').disabled = isCoffee || unknown;
  $<HTMLInputElement>('entry-volume').required = !isCoffee && !unknown;
  if (unknown) $<HTMLInputElement>('entry-stange').checked = true;
  $<HTMLInputElement>('entry-stange').disabled = unknown || packaged;
}
function openPrice(bar?: Bar, offer?: Offer) {
  if (!communityReady) return toast('Gemeinsame Preise sind gerade nicht verfügbar. Bitte neu laden.');
  editing = offer;
  $<HTMLFormElement>('price-form').reset();
  $('form-title').textContent = offer ? 'Preis ändern' : 'Preis eintragen';
  const select = $<HTMLSelectElement>('entry-bar');
  select.innerHTML = '<option value="">Lokal wählen</option>' + venues.map(b => `<option value="${e(b.id)}">${e(b.name)}${b.address ? ` · ${e(b.address)}` : ''}</option>`).join('');
  select.value = bar?.id || ''; select.disabled = Boolean(offer);
  $<HTMLSelectElement>('entry-drink').value = offer ? offer.coffeeType ? 'coffee' : 'beer' : f.drink!;
  $<HTMLSelectElement>('entry-drink').disabled = Boolean(offer);
  $<HTMLSelectElement>('entry-coffee').value = offer?.coffeeType || (f.coffeeType === 'all' ? 'creme' : f.coffeeType!);
  $<HTMLInputElement>('entry-name').value = offer?.name || '';
  $<HTMLInputElement>('entry-price').value = offer ? String(offer.priceChf) : '';
  $<HTMLInputElement>('entry-volume').value = String(offer?.volumeMl ? offer.volumeMl / 100 : f.volume === 'stange' ? 3 : f.volume === 'all' ? 5 : Number(f.volume) / 100);
  $<HTMLInputElement>('entry-stange').checked = offer?.serving === 'stange' || (!offer && f.volume === 'stange');
  $<HTMLInputElement>('entry-size-unknown').checked = Boolean(offer && !offer.coffeeType && offer.volumeMl === null);
  $<HTMLSelectElement>('entry-beer-type').value = offer ? effectiveBeerType(offer) : 'draft';
  $('entry-type-hint').hidden = !offer?.beerTypeEstimate || Boolean(offer.beerType && offer.beerType !== 'unknown');
  $<HTMLInputElement>('entry-alcohol').checked = offer?.alcoholFree ?? f.alcoholFree;
  $<HTMLInputElement>('entry-date').value = zurichToday(); $<HTMLInputElement>('entry-date').max = zurichToday();
  $<HTMLInputElement>('entry-source').value = offer?.sourceUrl || '';
  $('form-error').hidden = true;
  entryFields();
  $<HTMLDialogElement>('price-dialog').showModal();
  if (offer) $<HTMLInputElement>('entry-price').focus();
}
$('new-price').onclick = () => openPrice();
$('entry-drink').onchange = entryFields; $('entry-size-unknown').onchange = entryFields;
$('entry-beer-type').onchange = entryFields;
$('cancel-price').onclick = () => { if (!saving) $<HTMLDialogElement>('price-dialog').close(); };
$('price-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('price-form').onsubmit = async event => {
  event.preventDefault(); if (saving) return;
  $('form-error').hidden = true;
  try {
    const drink = $<HTMLSelectElement>('entry-drink').value as Drink;
    const input = validateInput({
      id: editing?.communityId, revision: editing?.revision || 0, targetKey: editing ? editing.originalKey || offerKey(editing) : undefined,
      barId: $<HTMLSelectElement>('entry-bar').value, drink,
      name: $<HTMLInputElement>('entry-name').value, priceChf: $<HTMLInputElement>('entry-price').valueAsNumber,
      volumeMl: drink === 'coffee' || $<HTMLInputElement>('entry-size-unknown').checked ? null : $<HTMLInputElement>('entry-volume').valueAsNumber * 100,
      beerType: drink === 'beer' ? $<HTMLSelectElement>('entry-beer-type').value as BeerType : undefined,
      coffeeType: drink === 'coffee' ? $<HTMLSelectElement>('entry-coffee').value : undefined,
      serving: drink === 'beer' && $<HTMLInputElement>('entry-stange').checked ? 'stange' : undefined,
      alcoholFree: drink === 'coffee' || $<HTMLInputElement>('entry-alcohol').checked,
      observedAt: $<HTMLInputElement>('entry-date').value, sourceUrl: $<HTMLInputElement>('entry-source').value,
    } satisfies PriceInput, venues);
    saving = true; $<HTMLButtonElement>('save-price').disabled = true; $<HTMLButtonElement>('cancel-price').disabled = true; $('save-price').textContent = 'Speichern …';
    const response = await fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
    const result = await response.json().catch(() => { throw new Error('Speichern gerade nicht möglich. Bitte erneut versuchen.'); });
    if (!response.ok) {
      if (response.status === 409 && await loadCommunity()) rebuild();
      throw new Error(result.error || 'Speichern fehlgeschlagen.');
    }
    const entry = result.entry as PriceEntry;
    entries = [...entries.filter(x => x.id !== entry.id), entry];
    f.drink = drink; selected = input.barId;
    // Keep the saved portion visible even if it differs from the current filter.
    f.mode = 'glass'; f.alcoholFree = input.alcoholFree;
    if (drink === 'coffee') f.coffeeType = input.coffeeType;
    else { f.volume = input.serving === 'stange' ? 'stange' : String(input.volumeMl); f.beerType = input.beerType || 'unknown'; }
    if (!Array.from($<HTMLSelectElement>('volume').options).some(x => x.value === f.volume)) f.volume = 'all';
    f.max = Math.max(f.max, input.priceChf); $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : '';
    $<HTMLInputElement>('alcohol-free').checked = f.alcoholFree;
    $<HTMLDialogElement>('price-dialog').close(); rebuild(); showView(false);
    const bar = bars.find(b => b.id === input.barId); if (bar) map.setView([bar.lat, bar.lon], 16);
    toast('Gespeichert. Für alle sichtbar.');
  } catch (error) {
    $('form-error').textContent = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name) ? error.message : 'Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.';
    $('form-error').hidden = false;
  } finally { saving = false; $<HTMLButtonElement>('save-price').disabled = false; $<HTMLButtonElement>('cancel-price').disabled = false; $('save-price').textContent = 'Speichern'; }
};
async function loadCommunity() {
  try {
    const response = await fetch('/api/prices', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!Array.isArray(result.entries)) throw new Error();
    entries = result.entries; communityReady = true;
    $<HTMLButtonElement>('new-price').disabled = !venues.length;
    return true;
  } catch { communityReady = false; $<HTMLButtonElement>('new-price').disabled = true; return false; }
}
async function init() {
  const [beerResult, coffeeResult, loadedCommunity] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}data/bars.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    fetch(`${import.meta.env.BASE_URL}data/coffee.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    loadCommunity(),
  ]);
  if (beerResult) datasets.beer = beerResult;
  if (coffeeResult) datasets.coffee = coffeeResult;
  venues = allVenues(datasets);
  $<HTMLButtonElement>('new-price').disabled = !communityReady || !venues.length;
  const errors = [!beerResult ? 'Bierdaten konnten nicht geladen werden.' : '', !coffeeResult ? 'Kaffeedaten konnten nicht geladen werden.' : '', !loadedCommunity ? 'Gemeinsame Einträge nicht verfügbar. Zum Eintragen bitte später neu laden.' : ''].filter(Boolean);
  if (errors.length) { $('load-error').textContent = errors.join(' '); $('load-error').hidden = false; }
  rebuild();
  const linkedId = initial.get('bar');
  if (linkedId) {
    const linkedBar = bars.find(b => b.id === linkedId);
    if (linkedBar) showBar(linkedBar);
    else toast('Das geteilte Lokal ist gerade nicht verfügbar.');
  }
}
void init();
