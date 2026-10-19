import { cities, cityFromPath, cityLink, type City } from './cities';
import L from 'leaflet';
import { inject } from '@vercel/analytics';
import { analyticsBeforeSend, trackEvent } from './analytics';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { cityAverage, coverageLabel, missingPriceLabel } from './coverage';

import { selectBeerSize, cheapPriceLimit, bestOffer, matchingOffers, isCurrentOffer, isComparableOffer, offerCategory, coffeeLabels, portion, effectiveBeerType, beerTypeLabel, beerTypeLabels, cost, escapeHtml as e, filterBars, isVenueEligible, matchesVenueType, safeUrl, type Bar, type Dataset, type Filters, type BeerType, type Offer } from './data';
import { communityVenues, applyEntries, offerKey, validateInput, zurichToday, type Drink, type PriceEntry, type PriceInput } from './community';
import { barLink, shareLink } from './sharing';
import { filtersFromSearch, writeFilters } from './filters';
import { createExport, downloadExport } from './export';
import { locationAtPosition, nearbyLocations, selectableLocations } from './locations';
import { createDistrictLookup, districtFromSearch, type Districts } from './districts';
import { searchSuggestions } from './search';
import { searchAddresses, type AddressResult } from './address-search';
import { prepareMenuPhoto, scanSummary, type MenuScanResult } from './menu-scan';
import { dateLocale, locale, localizedPath, t, type Locale } from './i18n';
import { venueForm } from './venue-form';

inject({ mode: import.meta.env.DEV ? 'development' : 'production', beforeSend: analyticsBeforeSend });

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => n.toFixed(2);
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => `<option value="${value}">${e(label)}</option>`).join('');
const translated = (labels: Record<string, string>) => Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, t(label)]));
const coffeeOptions = options(translated(coffeeLabels));
const venueTypes = { '': t('Alle (ohne Imbiss)'), all: t('Alle (inkl. Imbiss)'), bar: 'Bar / Pub', restaurant: 'Restaurant', cafe: 'Café', fast_food: t('Imbiss') };
const cityId = cityFromPath(location.pathname, import.meta.env.BASE_URL);
const city = cities[cityId];
const cityName = t(city.name);
const dataPath = `${import.meta.env.BASE_URL}data/${city.data}`;
const pricesApi = `/api/prices?city=${cityId}`;
const coffeePageTitle = document.title;
const initial = new URLSearchParams(location.search);
const f: Filters = filtersFromSearch(initial);
const districtState = districtFromSearch(initial, cityId);
let districtData: Districts | undefined;
let districtLookup: ReturnType<typeof createDistrictLookup> | undefined;
let districtsLoading = false;
const datasets: Partial<Record<Drink, Dataset>> = {};
let entries: PriceEntry[] = [], venues: Bar[] = [], bars: Bar[] = [], current: Bar[] = [];
let selected: string | undefined, position: [number, number] | undefined, editing: Offer | undefined;
let communityReady = false, saving = false, pizzaAvailable = false;
let cheapMode = initial.get('cheap') === '1';
let cheapLimit: number | undefined;
let locationCatalogue: Bar[] = [];
let addedVenues: Bar[] = [];
let userMarker: L.CircleMarker | undefined;
let suggestions: (Bar | AddressResult)[] = [], activeSuggestion = -1, searchOpen = false;
let addressResults: AddressResult[] = [], addressSelection: AddressResult | undefined;
let addressController: AbortController | undefined, addressTimer: ReturnType<typeof setTimeout> | undefined;
let addressStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let addressRequest = 0;
let addressPromise: Promise<void> | undefined;
let searchZoomTimer: ReturnType<typeof setTimeout> | undefined;
const coffee = () => f.drink === 'coffee';
const pizza = () => f.drink === 'pizza';
const beer = () => f.drink === 'beer';
const budgets: Record<Drink, number> = { beer: 15, coffee: 15, pizza: 30 };
const unit = (o: Offer) => offerCategory(o) !== 'beer' ? portion(o) : `${f.mode === 'half' ? `5 dl${o.volumeMl === 500 ? '' : ` · ${t('umgerechnet')}`}` : portion(o)} · ${beerTypeLabel(o)}`;

$('app').innerHTML = `
<div class="toolbar">
  <div class="toolbar-heading"><div class="switch" role="group" aria-label="${t('Kategorie')}"><button id="drink-coffee">${t('Kaffee')}</button><button id="drink-beer">${t('Bier')}</button><button id="drink-pizza" aria-label="Pizza Margherita" hidden>Pizza<span class="category-description"> Margherita</span></button></div><button id="toolbar-toggle" aria-expanded="true" aria-label="${t('Suche und Filter einklappen')}" title="${t('Suche und Filter einklappen')}"><span class="filter-chevron" aria-hidden="true"></span></button></div>
  <div class="search-box">
    <input id="search" type="search" role="combobox" placeholder="${t('Lokal, Adresse, PLZ oder Ort')}" aria-label="${t('Lokal oder Adresse suchen')}" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="search-suggestions">
    <button id="search-clear" type="button" aria-label="${t('Suche löschen')}" title="${t('Suche löschen')}" hidden><span aria-hidden="true">×</span></button>
    <div id="search-dropdown" hidden><div id="search-suggestions" role="listbox" aria-label="${t('Suchvorschläge')}"></div><p id="search-empty" role="status" hidden></p></div>
  </div>
  <div id="beer-controls" class="beer-controls">
    <select id="beer-type" aria-label="${t('Ausschank')}">${options({ draft: t('Offenbier'), bottle: t('Flaschenbier'), all: t('Alle Ausschankarten'), can: t('Dosenbier'), unknown: t('Unbekannt') })}</select>
    <select id="volume" aria-label="${t('Biergrösse')}">${options({ stange: 'Stange / 3 dl', '300-330': '3 / 3.3 dl', '500': '5 dl', '330': '3.3 dl', '400': '4 dl', all: t('Alle Grössen') })}</select>
  </div>
  <select id="coffeeType" aria-label="${t('Kaffeesorte oder Matcha Latte')}" hidden><option value="all">${e(t('Alle Kaffees & Matcha Latte'))}</option>${coffeeOptions}</select>
  <label class="budget">${t('Bis CHF')} <input id="price" aria-label="${t('Höchstpreis in CHF')}" type="number" min="0.5" max="50" step="0.5" value="15"></label>
  <button id="filters-toggle" aria-expanded="false" aria-controls="filters">${t('Filter')} <span class="filter-chevron" aria-hidden="true"></span></button>
</div>
<div id="filters" hidden>
  <label>${t('Lokal')} <select id="type">${options(venueTypes)}</select></label>
  <label><input id="unknown" type="checkbox" checked> ${t('Ohne passenden Preis anzeigen')}</label>
  <label><input id="outdoor" type="checkbox"> ${t('Draussen sitzen')}</label>
  <label id="alcohol-label"><input id="alcohol-free" type="checkbox"> ${t('Alkoholfrei')}</label>
  <label id="normalize-label"><input id="normalize" type="checkbox"> ${t('Auf 5 dl umrechnen')}</label>
  ${cityId === 'zurich' ? `<label><input id="district-toggle" type="checkbox" aria-controls="district-select-label"> ${t('Kreise anzeigen')}</label><label id="district-select-label" hidden>${t('Kreis')} <select id="district-select" aria-label="${t('Zürcher Stadtkreis')}"><option value="">${t('Alle Kreise')}</option></select></label>` : ''}
  <button id="reset">${t('Zurücksetzen')}</button>
</div>
<div class="status-row"><div class="status-summary" role="status"><strong id="city-average">${e(t('Schnitt {city} {value}', { city: cityName, value: '—' }))}</strong><strong id="district-average" hidden></strong><span id="count">${t('Laden …')}</span></div><div class="mobile-switch" role="group" aria-label="${t('Ansicht')}"><button id="view-map" aria-pressed="true">${t('Karte')}</button><button id="view-list" aria-pressed="false">${t('Liste')}</button></div><div class="status-meta"><small class="refresh-note">${t('Wird alle 3 Wochen aktualisiert')}</small><nav class="city-switch" aria-label="${t('Stadt wechseln')}">${(Object.keys(cities) as City[]).map(id => `<a data-city="${id}" href="${e(cityLink(id, location.search, import.meta.env.BASE_URL, locale()))}"${id === cityId ? ' aria-current="page"' : ''}>${t(cities[id].name)}</a>`).join('<span aria-hidden="true">/</span>')}</nav><button id="data-info" class="text-button">${t('Daten')}</button></div></div>
<div id="load-error" role="status" hidden></div>
<main>
  <aside class="list-panel" aria-label="${t('Lokale')}"><div class="list-tools"><a class="rankings-link" href="#kaffeepreise" aria-label="${t('Kaffee-Ranglisten und Quellen')}" title="${t('Kaffee-Ranglisten und Quellen')}">${t('Ranglisten')}</a><select id="sort" aria-label="${t('Sortierung')}">${options({ price: t('Preis aufsteigend'), price_desc: t('Preis absteigend'), name: 'Name A–Z', distance: t('Entfernung') })}</select></div><div id="results"></div></aside>
  <section class="map-panel" aria-label="${t('Karte')}"><div id="map"></div><div class="map-actions"><button id="locate" aria-pressed="false" aria-label="${t('Standort anzeigen')}" title="${t('Standort anzeigen')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg></button><button id="cheap" aria-pressed="false" disabled>${t('Günstig')}</button></div><section id="detail" aria-label="${t('Lokal und Preise')}" tabindex="-1" hidden></section>
<footer class="app-footer"><a href="mailto:team@whatshouldistudy.com?subject=${encodeURIComponent(t('Wunsch für wobillig'))}&amp;body=${encodeURIComponent(t('für wobillig wünsche ich mir:') + '\r\n\r\n')}">${t('Wunsch mitteilen')}</a></footer>
  </section>
</main>
<div id="toast" role="status" hidden></div>
<dialog id="share-dialog" aria-labelledby="share-title"><div class="dialog-top"><strong id="share-title">${t('Lokal teilen')}</strong><button id="close-share" type="button">${t('Schliessen')}</button></div><label for="share-url">${t('Diesen Link kopieren und teilen:')}</label><input id="share-url" type="url" readonly></dialog>
<dialog id="price-dialog" aria-label="${t('Preis eintragen')}"><form id="price-form">
  <div class="dialog-top"><strong id="form-title" tabindex="-1" autofocus>${t('Preis eintragen')}</strong><button id="cancel-price" type="button">${t('Schliessen')}</button></div>
  <input id="entry-bar" type="hidden">
  <label>${t('Lokal')}<input id="entry-bar-name" readonly></label><p id="entry-location" class="muted"></p>
  <section id="menu-scan" class="menu-scan" aria-label="${t('Karte scannen')}">
    <button id="scan-menu" class="primary" type="button">${t('Karte scannen / hochladen')}</button>
    <input id="menu-photo" type="file" accept="image/*" aria-label="${t('Menüfoto auswählen')}" hidden>
    <p class="muted">${t('Foto aufnehmen oder auswählen. Lesbare Bier-, Kaffee- und Margherita-Preise werden automatisch gespeichert.')}</p>
    <p class="scan-privacy">${t('Das Foto wird zur Erkennung an Anthropic gesendet und von wobillig nicht gespeichert.')}</p>
    <p id="scan-status" role="status" hidden></p>
  </section>
  <details id="manual-entry"><summary>${t('Preis von Hand eintragen')}</summary><fieldset id="manual-fields">
  <div class="form-row"><label>${t('Kategorie')}<select id="entry-drink"><option value="coffee">${t('Kaffee')}</option><option value="beer">${t('Bier')}</option><option value="pizza">Pizza Margherita</option></select></label><label id="entry-coffee-label" hidden>${t('Sorte')}<select id="entry-coffee">${coffeeOptions}</select></label></div>
  <label>${t('Bezeichnung')}<input id="entry-name" maxlength="100" placeholder="${t('z. B. Lager oder Espresso')}" required></label>
  <div id="entry-beer-fields"><label>${t('Ausschank')}<select id="entry-beer-type">${options(translated(beerTypeLabels))}</select></label><small id="entry-type-hint" class="muted" hidden>${t('Diese Vorauswahl ist geschätzt. Bitte prüfen.')}</small><div class="form-row"><label>${t('Menge in dl')}<input id="entry-volume" type="number" min="1" max="10" step="0.01" value="5"></label><label class="inline-check"><input id="entry-stange" type="checkbox"> Stange</label></div><label class="check"><input id="entry-size-unknown" type="checkbox"> ${t('Menge nicht angegeben (nur Stange)')}</label><label class="check"><input id="entry-alcohol" type="checkbox"> ${t('Alkoholfrei')}</label></div>
  <div class="form-row"><label>${t('Preis in CHF')}<input id="entry-price" type="number" min="0.5" max="50" step="0.01" inputmode="decimal" required></label><label>${t('Preis gesehen am')}<input id="entry-date" type="date" min="2020-01-01" required></label></div>
  <label>${t('Link zur Karte (optional)')}<input id="entry-source" type="url" maxlength="1500" placeholder="https://…"></label>
  <p class="muted">${t('Wird für alle sichtbar. Bitte den tatsächlichen Preis dieser Portion eintragen.')}</p>
  <button id="save-price" class="primary" type="submit">${t('Speichern')}</button>
  </fieldset></details>
  <p id="form-error" role="alert" hidden></p>
</form></dialog>
<dialog id="info" aria-label="${t('Daten')}"><div class="dialog-top"><strong>${t('Daten')}</strong><button id="close-info">${t('Schliessen')}</button></div><section class="data-download" aria-labelledby="download-title"><strong id="download-title">${e(t('Daten für {city} herunterladen', { city: cityName }))}</strong><p>${t('Alle erfassten Angebote für Bier, Kaffee und Pizza, unabhängig von deinen Filtern. Mit Originalpreisen in CHF, Mengen, Quellen, Datum und Prüfstatus sowie verfügbaren gemeinsamen Korrekturen.')}</p><div class="download-actions"><button id="download-csv" class="primary" disabled>${t('CSV herunterladen')}</button><button id="download-json" disabled>${t('JSON herunterladen')}</button></div><p class="muted">${t('CSV: eine Zeile pro Angebot, UTF-8, Semikolon als Trennzeichen. JSON enthält zusätzlich Lokale ohne Preis und die vollständigen Angebotsdetails. Abgelaufene Angebote sind im CSV gekennzeichnet; im JSON bleibt das Fotodatum erhalten.')}</p><p id="download-status" class="muted" role="status">${t('Daten werden geladen …')}</p></section><p id="coverage"></p><p>${t('Der Stadtdurchschnitt verwendet den günstigsten passenden Preis je Lokal für die gewählte Sorte, Biergrösse und Ausschankart. Alkoholfrei und die optionale Umrechnung auf 5 dl werden berücksichtigt. Suche, Preislimit, «Günstig», Lokaltyp und «Draussen sitzen» verändern diesen stadtweiten Vergleichswert nicht. Lokale ohne passenden Preis zählen nicht mit. Bei «Alle» wird das jeweils günstigste passende Angebot verwendet.')}</p>${cityId === 'zurich' ? `<p>${t('Kreise: Unter «Filter» lassen sich die Stadtkreise einblenden und per Karte oder Auswahlfeld auswählen. Der Kreisdurchschnitt wird wie der Stadtdurchschnitt berechnet, jedoch nur mit Lokalen innerhalb der gewählten Kreisgrenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis.')} ${t('Kreisgrenzen:')} <a href="https://data.stadt-zuerich.ch/dataset/geo_stadtkreise" target="_blank" rel="noopener noreferrer">${t('Stadt Zürich, Stadtkreise (CC0)')}</a>.</p>` : ''}<p>${t('Preise stammen aus verlinkten Speise- und Getränkekarten oder wurden von Besuchern eingetragen. Eingetragene Preise und Foto-Uploads behalten Vorrang, ausser eine belegbar neuere Website-Karte nennt einen abweichenden Preis. Quelle, Menge und Datum stehen beim Angebot.')}</p><p>${t('Pizza: Preis pro ganzer, normaler Margherita im Lokal. Grössen können je nach Restaurant abweichen. Kinderpizzen, Spezialvarianten und reine Liefer- oder Take-away-Preise sind ausgeschlossen.')}</p><p>${t('Bier: Cafés erscheinen mit einem erfassten, aktuellen Bierangebot unabhängig von ihren Öffnungszeiten. Cafés ohne Bierangebot werden auch bei «Ohne passenden Preis anzeigen» ausgeblendet.')}</p><p>${t('Stange: 3 dl oder ausdrücklich als Stange bezeichnete kleine Portion; bekannte Flaschen und Dosen sind ausgeschlossen. Fehlt die Ausschankart in der Quelle, wird sie anhand von Menü, Bezeichnung und Menge geschätzt. Solche Angaben sind als «geschätzt» gekennzeichnet und zählen im Ausschank-Filter mit. Fehlende Mengen bleiben offen. Die optionale Umrechnung auf 5 dl ist ein Vergleichspreis.')}</p><p>${t('Neue Einträge und Korrekturen werden gemeinsam gespeichert. Zum Begrenzen von Spam wird kurzzeitig eine nicht rücklesbare Kennung aus der IP-Adresse gespeichert. Dein Standort bleibt im Browser.')}</p><p>${t('Standorte und Karte:')} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">${t('© OpenStreetMap-Mitwirkende, ODbL')}</a>.</p></dialog>`;

const map = L.map('map', { zoomControl: false }).setView(city.center, 14);
const openVenueForm = venueForm(cityId, pricesApi, () => selectableLocations(venues, locationCatalogue), (bar, created) => {
  if (!addedVenues.some(b => b.id === bar.id)) addedVenues.push(bar);
  clearAddressSelection(); f.query = ''; f.type = 'all'; f.unknown = true; f.outdoor = false;
  districtState.selected = undefined; cheapMode = false; f.drink = 'coffee'; selected = bar.id;
  closeSearchSuggestions(); rebuild(); showBar(bar, 18);
  toast(created ? t('Lokal gespeichert und für alle sichtbar. Du kannst jetzt Preise hinzufügen.') : t('Dieses Lokal ist bereits vorhanden. Du kannst hier Preise hinzufügen.'));
});
const addVenueButton = document.createElement('button');
addVenueButton.id = 'add-venue'; addVenueButton.className = 'text-button'; addVenueButton.textContent = t('Lokal hinzufügen');
$('data-info').before(addVenueButton);
addVenueButton.onclick = () => {
  if (!communityReady) return toast(t('Gemeinsame Einträge sind gerade nicht verfügbar. Bitte neu laden.'));
  openVenueForm(map.getCenter(), addressSelection ? '' : f.query.trim());
};
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
let mapMoving = false;
let revealFrame: number | undefined;
let pendingReveal: { id: string; zoom?: number } | undefined;
map.on('movestart', () => { mapMoving = true; });
map.on('moveend', () => {
  mapMoving = false;
  if (pendingReveal) scheduleBarReveal();
});
function scheduleBarReveal(zoom?: number) {
  if (!selected) { pendingReveal = undefined; return; }
  pendingReveal = { id: selected, zoom: zoom ?? (pendingReveal?.id === selected ? pendingReveal.zoom : undefined) };
  if (revealFrame !== undefined) return;
  revealFrame = requestAnimationFrame(() => {
    revealFrame = undefined;
    if (mapMoving) return;
    const request = pendingReveal; pendingReveal = undefined;
    const bar = request?.id === selected ? selectedLocation() : undefined;
    if (bar) revealBarInVisibleMap(bar, request?.zoom);
  });
}
const mapLayoutObserver = new ResizeObserver(() => {
  map.invalidateSize({ pan: false });
  scheduleBarReveal();
});
mapLayoutObserver.observe($('map'));
mapLayoutObserver.observe($('detail'));
map.createPane('districts').style.zIndex = '350';
const districtLayer = L.geoJSON(undefined, { pane: 'districts', bubblingMouseEvents: false });
const layer = L.layerGroup().addTo(map);
const locationLayer = L.layerGroup().addTo(map);
const detailMarkersMinZoom = 17;
map.on('moveend', renderLocations);
map.on('click', event => {
  if (map.getZoom() < detailMarkersMinZoom) { toast(t('Zum Auswählen eines Lokals näher heranzoomen.')); return; }
  const choices = nearbyLocations(mapLocations(), event.containerPoint, b => map.latLngToContainerPoint([b.lat, b.lon]));
  if (!choices.length) { toast(t('Hier wurde kein Lokal gefunden. Tippe auf das Symbol oder näher an den Namen.')); return; }
  if (choices.length === 1) { openPrice(choices[0]); return; }
  const content = document.createElement('div');
  content.className = 'location-choices';
  const title = document.createElement('strong'); title.textContent = t('Für welches Lokal?'); content.append(title);
  for (const bar of choices) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = [bar.name, bar.address].filter(Boolean).join(' · ');
    button.onclick = () => { map.closePopup(); openPrice(bar); };
    content.append(button);
  }
  L.popup().setLatLng(event.latlng).setContent(content).openOn(map);
});
// Show unpriced dots at the same zoom as the orange location markers.
// Hide detail markers/labels during zoom gestures, including touch pinch zoom.
// Toggle visibility directly so zooming does not rebuild every marker and result.
const venueNamesMinZoom = 19;
const syncZoomVisibility = () => {
  $('map').classList.toggle('show-unpriced-markers', map.getZoom() >= detailMarkersMinZoom);
  $('map').classList.toggle('show-venue-names', map.getZoom() >= venueNamesMinZoom);
};
map.on('zoomstart', () => $('map').classList.remove('show-unpriced-markers', 'show-venue-names'));
map.on('zoomend', syncZoomVisibility);
syncZoomVisibility();
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function showView(list: boolean) {
  document.body.classList.toggle('show-list', list);
  $('view-map').setAttribute('aria-pressed', String(!list)); $('view-list').setAttribute('aria-pressed', String(list));
  map.invalidateSize();
}
function inSelectedDistrict(bar: Bar) {
  return !districtState.enabled || !districtState.selected || !districtLookup || districtLookup(bar) === districtState.selected;
}
async function loadDistricts() {
  if (districtData || districtsLoading) return;
  districtsLoading = true;
  renderDistricts();
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/districts.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Kreisgrenzen fehlen');
    districtData = await response.json() as Districts;
    districtLookup = createDistrictLookup(districtData);
    districtLayer.addData(districtData);
    districtLayer.eachLayer(layer => {
      const polygon = layer as L.Polygon & { feature: { properties: { number: number } } };
      const number = polygon.feature.properties.number;
      polygon.on('click', () => chooseDistrict(districtState.selected === number ? undefined : number));
      polygon.on('mouseover', () => polygon.setStyle({ weight: 3, fillOpacity: districtState.selected ? .25 : 0 }));
      polygon.on('mouseout', () => polygon.setStyle(districtStyle(number)));
    });
  } catch {
    districtData = undefined;
    districtState.enabled = false; districtState.selected = undefined;
    toast(t('Kreisgrenzen konnten nicht geladen werden. Bitte «Kreise anzeigen» erneut aktivieren.'));
  } finally {
    districtsLoading = false;
    render();
  }
}
function districtStyle(number: number): L.PathOptions {
  const active = districtState.selected === number;
  return { color: active ? 'var(--blue)' : 'var(--district-line)', weight: active ? 3 : 1.5, fillColor: '#2679c9', fillOpacity: active ? .24 : districtState.selected ? .035 : 0 };
}
function chooseDistrict(number: number | undefined) {
  districtState.selected = number;
  selected = undefined;
  render();
  if (number) {
    districtLayer.eachLayer(layer => {
      const polygon = layer as L.Polygon & { feature: { properties: { number: number } } };
      if (polygon.feature.properties.number === number) map.fitBounds(polygon.getBounds(), { padding: [30, 60], maxZoom: 15 });
    });
  }
}
function renderDistricts() {
  if (cityId !== 'zurich') return;
  const enabled = districtState.enabled;
  $<HTMLInputElement>('district-toggle').checked = enabled;
  $('district-select-label').hidden = !enabled;
  const select = $<HTMLSelectElement>('district-select');
  select.disabled = !districtData;
  $('district-average').hidden = true;
  if (!enabled || !districtData) {
    districtLayer.remove();
    select.innerHTML = `<option value="">${districtsLoading ? t('Kreise laden …') : t('Alle Kreise')}</option>`;
    return;
  }
  if (!map.hasLayer(districtLayer)) districtLayer.addTo(map);
  const averages = new Map(districtData.features.map(d => {
    const number = d.properties.number;
    return [number, cityAverage(bars.filter(b => districtLookup!(b) === number), f)];
  }));
  const label = (number: number) => {
    const average = averages.get(number);
    return `${t('Kreis {number}', { number })} · ${average ? `Ø CHF ${money(average.price)} (${average.count})` : t('kein passender Preis')}`;
  };
  select.innerHTML = `<option value="">${t('Alle Kreise')}</option>` + districtData.features.map(d => `<option value="${d.properties.number}">${label(d.properties.number)}</option>`).join('');
  select.value = districtState.selected ? String(districtState.selected) : '';
  districtLayer.eachLayer(layer => {
    const polygon = layer as L.Polygon & { feature: { properties: { number: number } } };
    const number = polygon.feature.properties.number;
    polygon.setStyle(districtStyle(number));
    if (polygon.getTooltip()) polygon.setTooltipContent(label(number));
    else polygon.bindTooltip(label(number), { sticky: true, className: 'district-tooltip' });
  });
  if (districtState.selected) {
    const average = averages.get(districtState.selected);
    $('district-average').hidden = false;
    $('district-average').textContent = average
      ? t('Schnitt Kreis {number} CHF {price} ({count} Lokale)', { number: districtState.selected, price: money(average.price), count: average.count })
      : t('Schnitt Kreis {number} — keine passenden Preise', { number: districtState.selected });
    $('district-average').title = t('Günstigster passender Preis je Lokal im Kreis. Unabhängig von Suche, Preislimit, Günstig-Filter, Lokaltyp und Draussen-Filter.');
  }
}
if (cityId === 'zurich') {
  $('district-toggle').onchange = () => {
    districtState.enabled = $<HTMLInputElement>('district-toggle').checked;
    if (!districtState.enabled) districtState.selected = undefined;
    selected = undefined;
    render();
    if (districtState.enabled) void loadDistricts();
  };
  $('district-select').onchange = () => chooseDistrict(Number($<HTMLSelectElement>('district-select').value) || undefined);
}
function rebuild() {
  venues = communityVenues(datasets, entries, addedVenues);
  const pizzaBars = datasets.pizza ? applyEntries(datasets.pizza, entries, venues, 'pizza').bars : [];
  // Count priced venues city-wide, including contributions, independently of UI filters.
  pizzaAvailable = pizzaBars.filter(b => b.offers.some(o => o.pizzaType === 'margherita' && isCurrentOffer(o) && isComparableOffer(o))).length >= 20;
  $('drink-pizza').hidden = !pizzaAvailable;
  if (pizza() && !pizzaAvailable) {
    f.drink = 'coffee'; f.max = budgets.coffee; f.mode = 'glass'; selected = undefined;
    $<HTMLInputElement>('price').value = String(f.max);
  }
  const base = datasets[f.drink!];
  bars = pizza() ? pizzaBars : base ? applyEntries(base, entries, venues, f.drink!).bars : [];
  render();
}
function syncControls() {
  const heading = beer() ? t('Bierpreise {city}', { city: cityName }) : pizza() ? t('Pizzapreise {city}', { city: cityName }) : t('Kaffeepreise {city}', { city: cityName });
  if ($('map-title').textContent !== heading) $('map-title').textContent = heading;
  document.title = coffee() ? coffeePageTitle : t('{heading} vergleichen | wobillig', { heading });
  $<HTMLSelectElement>('type').innerHTML = options(venueTypes);
  $<HTMLSelectElement>('type').value = f.type;
  $('beer-controls').hidden = !beer(); $('coffeeType').hidden = !coffee();
  $<HTMLSelectElement>('volume').querySelector<HTMLOptionElement>('[value=stange]')!.disabled = ['bottle', 'can'].includes(f.beerType!);
  $<HTMLSelectElement>('beer-type').value = f.beerType || 'all';
  $('alcohol-label').hidden = !beer(); $('normalize-label').hidden = !beer() || ['stange', '300', '300-330'].includes(f.volume);
  $<HTMLSelectElement>('volume').value = f.volume;
  $<HTMLSelectElement>('coffeeType').value = f.coffeeType!;
  $<HTMLInputElement>('normalize').checked = f.mode === 'half';
  for (const drink of ['beer', 'coffee', 'pizza']) $('drink-' + drink).setAttribute('aria-pressed', String(f.drink === drink));
  $<HTMLInputElement>('search').value = f.query;
  $('search-clear').hidden = f.query.length === 0;
  $<HTMLSelectElement>('sort').value = f.sort;
  $<HTMLInputElement>('outdoor').checked = f.outdoor;
  $<HTMLInputElement>('alcohol-free').checked = f.alcoholFree;
  const url = new URL(location.href);
  writeFilters(url.searchParams, f, cheapMode);
  if (addressSelection) url.searchParams.set('address', '1'); else url.searchParams.delete('address');
  if (cityId === 'zurich' && districtState.enabled) url.searchParams.set('kreise', '1'); else url.searchParams.delete('kreise');
  if (cityId === 'zurich' && districtState.enabled && districtState.selected) url.searchParams.set('kreis', String(districtState.selected)); else url.searchParams.delete('kreis');
  if (selected) url.searchParams.set('bar', selected); else url.searchParams.delete('bar');
  history.replaceState(null, '', url);
  document.querySelectorAll<HTMLAnchorElement>('[data-city]').forEach(link => { link.href = cityLink(link.dataset.city as City, url.search, import.meta.env.BASE_URL, locale()); });
  // The language switch keeps the whole view, including the selected venue.
  document.querySelectorAll<HTMLAnchorElement>('[data-locale]').forEach(link => { link.href = import.meta.env.BASE_URL.replace(/\/$/, '') + localizedPath(city.path, link.dataset.locale as Locale) + url.search; });
}
function selectedLocation() {
  return bars.find(b => b.id === selected) || locationCatalogue.find(b => b.id === selected);
}
function render() {
  const selection = selectedLocation();
  if (selected && (!selection || !isVenueEligible(selection, f) || !inSelectedDistrict(selection))) selected = undefined;
  syncControls();
  const districtBars = bars.filter(inSelectedDistrict);
  cheapLimit = cheapPriceLimit(districtBars, addressSelection ? { ...f, query: '' } : f);
  const cheapButton = $<HTMLButtonElement>('cheap');
  cheapButton.textContent = cheapLimit === undefined ? t('Günstig') : t('Günstig bis CHF {price}', { price: Number.isInteger(cheapLimit) ? cheapLimit : cheapLimit.toFixed(2) });
  cheapButton.disabled = cheapLimit === undefined && !cheapMode;
  cheapButton.setAttribute('aria-pressed', String(cheapMode));
  cheapButton.title = cheapLimit === undefined ? t('Keine passenden Preise vorhanden') : cheapMode ? t('Günstig-Filter aufheben') : t('Günstige Lokale für die aktuelle Auswahl anzeigen');
  const searchFilters = addressSelection ? { ...f, query: '' } : f;
  const activeFilters = cheapMode ? { ...searchFilters, max: cheapLimit ?? -Infinity, unknown: false } : searchFilters;
  if (document.activeElement !== $('price')) $<HTMLInputElement>('price').value = Number.isFinite(activeFilters.max) && activeFilters.max > 0 ? String(activeFilters.max) : '';
  $<HTMLInputElement>('unknown').checked = activeFilters.unknown;
  current = filterBars(districtBars, activeFilters, addressSelection ? [addressSelection.lat, addressSelection.lon] : position);
  renderDistricts();
  $('count').textContent = coverageLabel(current, f) + (addressSelection ? ` · ${t('Bezugspunkt: {label}', { label: addressSelection.label })}` : '');
  const average = cityAverage(bars, f);
  $('city-average').textContent = t('Schnitt {city} {value}', { city: cityName, value: average ? `CHF ${money(average.price)}` : '—' });
  const comparison = pizza() ? 'Pizza Margherita' : coffee() ? (f.coffeeType === 'all' ? t('alle Kaffees & Matcha Latte') : t(coffeeLabels[f.coffeeType!])) : t('Bier · {size} · {mode}', {
    size: f.volume === 'all' ? t('alle Grössen') : f.volume === 'stange' ? 'Stange' : f.volume === '300-330' ? '3 / 3.3 dl' : `${Number(f.volume) / 100} dl`,
    mode: f.mode === 'half' ? t('auf 5 dl umgerechnet') : t('Portionspreis'),
  });
  $('city-average').title = average
    ? t('{comparison}: Durchschnitt des günstigsten passenden Preises pro Lokal ({count} Lokale). Stadtweit, unabhängig von Suche, Preislimit, Günstig-Filter, Lokaltyp und Draussen-Filter.', { comparison, count: average.count })
    : t('{comparison}: Noch keine passenden Preise für den Stadtdurchschnitt vorhanden.', { comparison });
  $('results').innerHTML = current.length ? current.map(b => {
    const o = bestOffer(b, f);
    return `<button class="venue ${selected === b.id ? 'selected' : ''}" data-bar="${e(b.id)}"><span><strong>${e(b.name)}</strong><small>${e(b.address || b.postcode || cityName)}</small>${o ? `<small>${e(unit(o))}</small>` : ''}</span><span class="venue-price">${o ? money(cost(o, f.mode)) : `<small>${missingPriceLabel(b, f)}</small>`}</span></button>`;
  }).join('') : `<p class="empty">${t('Keine passenden Lokale.')}</p>`;
  layer.clearLayers();
  const selectedBar = selectedLocation();
  const mapped = selectedBar && !current.includes(selectedBar) ? [...current, selectedBar] : current;
  for (const b of mapped) {
    const o = bestOffer(b, f);
    const label = `${b.name}: ${o ? `CHF ${money(cost(o, f.mode))} / ${unit(o)}` : t('kein passender Preis')}`;
    L.marker([b.lat, b.lon], {
      icon: L.divIcon({
        className: `marker-wrap${o ? '' : ' unpriced-marker'}`,
        html: o
          ? `<span class="price-marker ${b.id === selected ? 'active' : ''}">${money(cost(o, f.mode))}</span>`
          : `<span class="price-marker unknown ${b.id === selected ? 'active' : ''}">·</span><span class="venue-marker-name">${e(b.name)}</span>`,
        iconSize: o ? [54, 26] : [44, 44],
        iconAnchor: o ? [27, 13] : [22, 22],
      }),
      title: label, alt: label, zIndexOffset: b.id === selected ? 2000 : o ? 1000 : 0,
    }).addTo(layer).on('click', () => showBar(b));
  }
  $('results').querySelectorAll<HTMLButtonElement>('[data-bar]').forEach(button => button.onclick = () => showBar(bars.find(b => b.id === button.dataset.bar)!));
  if (selectedBar) detail(selectedBar); else $('detail').hidden = true;
  renderLocations();
  renderSearchSuggestions();
}
let addressMarker: L.CircleMarker | undefined;
function clearAddressSelection() {
  if (addressSelection && f.sort === 'distance' && !position) f.sort = 'price';
  addressSelection = undefined; addressMarker?.remove(); addressMarker = undefined;
}
function cancelAddressRequest() {
  clearTimeout(addressTimer); addressController?.abort(); addressRequest++;
  addressPromise = undefined; addressResults = []; addressStatus = 'idle';
}
function scheduleAddressSearch() {
  if (f.query.trim().length < 2) return;
  addressStatus = 'loading'; renderSearchSuggestions();
  clearTimeout(addressTimer);
  addressTimer = setTimeout(() => void loadAddressResults(), 350);
}
async function loadAddressResults(): Promise<void> {
  clearTimeout(addressTimer);
  if (addressPromise) return addressPromise;
  if (f.query.trim().length < 2) return;
  const request = ++addressRequest, query = f.query;
  addressController = new AbortController();
  const controller = addressController;
  const timeout = setTimeout(() => controller.abort(), 8000);
  addressStatus = 'loading'; renderSearchSuggestions();
  addressPromise = (async () => {
    try {
      const results = await searchAddresses(query, city.center, controller.signal, city.name);
      if (request !== addressRequest || query !== f.query) return;
      addressResults = results; addressStatus = 'ready';
    } catch {
      if (request !== addressRequest) return;
      addressResults = []; addressStatus = 'error';
    } finally {
      clearTimeout(timeout);
      if (request === addressRequest) { addressPromise = undefined; renderSearchSuggestions(); }
    }
  })();
  return addressPromise;
}
function searchCandidates() { return bars.filter(b => isVenueEligible(b, f) && inSelectedDistrict(b)); }
function closeSearchSuggestions() {
  searchOpen = false; activeSuggestion = -1; suggestions = [];
  $('search-dropdown').hidden = true;
  $('search').setAttribute('aria-expanded', 'false');
  $('search').removeAttribute('aria-activedescendant');
}
function renderSearchSuggestions() {
  if (!searchOpen || !f.query.trim()) { closeSearchSuggestions(); return; }
  const active = suggestions[activeSuggestion];
  const venues = searchSuggestions(searchCandidates(), f.query);
  suggestions = /\d/.test(f.query) ? [...addressResults, ...venues] : [...venues, ...addressResults];
  activeSuggestion = active ? suggestions.indexOf(active) : -1;
  $('search-dropdown').hidden = false;
  $('search').setAttribute('aria-expanded', 'true');
  $('search-empty').hidden = suggestions.length > 0 && addressStatus !== 'loading' && addressStatus !== 'error';
  $('search-empty').textContent = addressStatus === 'loading' ? t('Adressen werden gesucht …')
    : addressStatus === 'error' ? t('Adresssuche gerade nicht verfügbar. Mit Enter erneut versuchen.')
    : f.query.trim().length < 2 ? t('Mindestens zwei Zeichen eingeben.') : t('Keine Lokale oder Adressen gefunden. Versuche Strasse, Hausnummer, PLZ oder Ort.');
  const visible = new Set(current.map(b => b.id));
  $('search-suggestions').innerHTML = suggestions.map((b, index) => {
    if ('kind' in b) return `<button type="button" role="option" tabindex="-1" id="search-option-${index}" data-suggestion="${index}" aria-selected="${index === activeSuggestion}"><strong>${e(b.label)}</strong><small>${t('Adresse / Ort · Auf Karte anzeigen')}</small></button>`;
    const offer = bestOffer(b, f);
    return `<button type="button" role="option" tabindex="-1" id="search-option-${index}" data-suggestion="${index}" aria-selected="${index === activeSuggestion}"><strong>${e(b.name)}</strong><small>${e([b.address, b.postcode].filter(Boolean).join(' · ') || cityName)}</small><small>${offer ? `CHF ${money(cost(offer, f.mode))} · ${e(unit(offer))}` : missingPriceLabel(b, f)}${visible.has(b.id) ? '' : ` · ${t('ausserhalb der aktuellen Filter')}`}</small></button>`;
  }).join('');
  if (activeSuggestion >= 0) $('search').setAttribute('aria-activedescendant', `search-option-${activeSuggestion}`);
  else $('search').removeAttribute('aria-activedescendant');
  $('search-suggestions').querySelectorAll<HTMLButtonElement>('[data-suggestion]').forEach(button => {
    button.onpointerdown = event => event.preventDefault();
    button.onclick = () => selectSearchSuggestion(Number(button.dataset.suggestion));
  });
}
function zoomToSearchResults() {
  if (!f.query.trim()) return;
  if (addressSelection) return;
  const matches = current.length ? current : searchSuggestions(searchCandidates(), f.query, Infinity);
  if (matches.length === 1) map.setView([matches[0].lat, matches[0].lon], 17);
  else if (matches.length) map.fitBounds(L.latLngBounds(matches.map(b => [b.lat, b.lon] as [number, number])), { padding: [45, 60], maxZoom: 17 });
}
function selectSearchSuggestion(index: number) {
  const bar = suggestions[index];
  if (!bar) return;
  clearTimeout(searchZoomTimer);
  cancelAddressRequest();
  closeSearchSuggestions();
  if ('kind' in bar) {
    addressSelection = bar;
    f.query = bar.label; f.sort = 'distance'; selected = undefined;
    addressMarker?.remove();
    addressMarker = L.circleMarker([bar.lat, bar.lon], { radius: 9, color: '#fff', fillColor: '#1766c2', fillOpacity: 1, weight: 3 })
      .bindTooltip(() => { const label = document.createElement('span'); label.textContent = bar.label; return label; }, { permanent: true }).addTo(map);
    $('search').blur(); showView(false); render();
    map.setView([bar.lat, bar.lon], bar.origin === 'address' ? 17 : 14);
    return;
  }
  clearAddressSelection();
  f.query = bar.name;
  $('search').blur();
  if (matchMedia('(max-width: 760px)').matches) {
    $('filters').hidden = true; $('filters-toggle').setAttribute('aria-expanded', 'false');
  }
  showBar(bar, 17);
}
function mapLocations(): Bar[] {
  // The pizza dataset includes confirmed pizzerias without prices and community
  // pizza entries. Do not add the general restaurant catalogue back to this map.
  const candidates = pizza() ? bars : selectableLocations(venues, locationCatalogue);
  return candidates.filter(b => matchesVenueType(b, f) && inSelectedDistrict(b));
}
function renderLocations() {
  locationLayer.clearLayers();
  if (map.getZoom() < detailMarkersMinZoom) return;
  const displayed = new Set([...current.map(b => b.id), ...(selected ? [selected] : [])]);
  for (const bar of mapLocations()) {
    if (displayed.has(bar.id) || !map.getBounds().pad(.1).contains([bar.lat, bar.lon])) continue;
    const label = `${bar.name}: ${t('Preis eintragen')}`;
    L.marker([bar.lat, bar.lon], {
      icon: L.divIcon({ className: 'location-marker', html: '<span aria-hidden="true">+</span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: label, alt: label, zIndexOffset: -1000, bubblingMouseEvents: false,
    }).addTo(locationLayer).bindTooltip(e(bar.name), { direction: 'top' }).on('click', () => openPrice(bar));
  }
}
function detail(b: Bar) {
  const matches = matchingOffers(b, f);
  const other = b.offers.filter(o => isCurrentOffer(o) && isComparableOffer(o) && !matches.includes(o));
  const offers = [...matches, ...other];
  $('detail').innerHTML = `<div class="detail-top"><strong>${e(b.name)}</strong><button id="close-detail">${t('Schliessen')}</button></div><p class="muted">${e(b.address ? [b.address, b.postcode].filter(Boolean).join(' ') : t('Adresse noch nicht erfasst'))}</p><div class="detail-actions"><button id="add-here" class="primary">${t('Preis hinzufügen')}</button><button id="share-bar" aria-label="${e(t('{name} teilen', { name: b.name }))}">${t('Teilen')}</button></div>${offers.length ? offers.map((o, i) => `<div class="offer ${matches.includes(o) ? '' : 'other-offer'}"><div class="offer-top"><strong>${e(o.name)}</strong><strong class="nowrap">CHF ${money(o.priceChf)}</strong></div><div class="muted">${e(portion(o))}${offerCategory(o) === 'beer' ? ' · ' + e(t(beerTypeLabels[effectiveBeerType(o)])) : ''}${offerCategory(o) === 'beer' && o.alcoholFree ? ` · ${t('alkoholfrei')}` : ''}${!matches.includes(o) ? ` · ${t('ausserhalb Filter')}` : ''}</div>${offerCategory(o) === 'beer' && o.beerTypeEstimate && (!o.beerType || o.beerType === 'unknown') ? `<details class="estimate muted"><summary>${t('geschätzt')}</summary><p>${e(o.beerTypeEstimate.reason)}</p></details>` : ''}<div class="offer-meta"><span>${o.photoSource ? `${t('Google-Maps-Foto')} · ${e(o.photoSource.date)} · ` : ''}${o.menuScan ? t('Foto-Upload') : o.confidence === 'community' ? t('Eingetragen') : o.confidence === 'reviewed' ? t('Manuell geprüft') : o.confidence === 'ai' ? t('KI-erkannt') : t('Automatisch erkannt')} · ${e(new Date(o.verifiedMenuDate?.date || o.observedAt).toLocaleDateString(dateLocale()))}</span>${safeUrl(o.sourceUrl) ? `<a href="${safeUrl(o.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Quelle')}</a>` : ''}<button data-edit="${i}">${t('Ändern')}</button></div></div>`).join('') : `<p>${t('Noch kein Preis eingetragen.')}</p>`}${safeUrl(b.website) ? `<p><a href="${safeUrl(b.website)}" target="_blank" rel="noopener noreferrer">Website</a></p>` : ''}`;
  $('detail').hidden = false;
  $('close-detail').onclick = () => {
    clearTimeout(searchZoomTimer); closeSearchSuggestions();
    selected = undefined; f.query = '';
    render();
  };
  $('add-here').onclick = () => openPrice(b);
  $('share-bar').onclick = async () => {
    const button = $<HTMLButtonElement>('share-bar');
    const url = barLink(location.href, b.id, f.drink!, f.volume, f.beerType);
    button.disabled = true;
    try {
      const result = await shareLink({ title: `${b.name} · wobillig`, url });
      trackEvent(cityId, 'venue_shared', { category: f.drink!, result });
      if (result === 'copied') toast(t('Link kopiert.'));
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
function revealBarInVisibleMap(b: Bar, zoom = map.getZoom()) {
  const mapRect = $('map').getBoundingClientRect();
  if (!mapRect.width || !mapRect.height) return;
  const detailRect = $('detail').getBoundingClientRect();
  let visibleWidth = mapRect.width, visibleHeight = mapRect.height;
  if (!$('detail').hidden) {
    if (matchMedia('(max-width: 760px)').matches) visibleHeight = Math.max(0, detailRect.top - mapRect.top);
    else visibleWidth = Math.max(0, detailRect.left - mapRect.left);
  }
  if (!visibleWidth || !visibleHeight) return;
  // Leave a visible marker where it is, including at the current zoom level.
  const point = map.latLngToContainerPoint([b.lat, b.lon]);
  const paddingX = Math.min(32, visibleWidth / 2), paddingY = Math.min(24, visibleHeight / 2);
  const target = L.point(
    Math.max(paddingX, Math.min(visibleWidth - paddingX, point.x)),
    Math.max(paddingY, Math.min(visibleHeight - paddingY, point.y)),
  );
  const delta = point.subtract(target);
  if (Math.abs(delta.x) < 1 && Math.abs(delta.y) < 1) return;
  const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (zoom > map.getZoom()) {
    const offset = L.point((mapRect.width - visibleWidth) / 2, (mapRect.height - visibleHeight) / 2);
    const center = map.unproject(map.project([b.lat, b.lon], zoom).add(offset), zoom);
    map.flyTo(center, zoom, { animate, duration: .5 });
  } else {
    // Move only as far as necessary to uncover the marker.
    map.panBy(delta, { animate, duration: .45 });
  }
}
function showBar(b: Bar, zoom?: number) {
  clearTimeout(searchZoomTimer); closeSearchSuggestions(); selected = b.id;
  showView(false); render();
  scheduleBarReveal(zoom);
  $('detail').focus({ preventScroll: true });
}
function chooseDrink(drink: Drink) { if (drink !== f.drink) trackEvent(cityId, 'category_changed', { category: drink }); budgets[f.drink!] = f.max; f.max = budgets[drink]; $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : ''; f.drink = drink; f.mode = 'glass'; selected = undefined; rebuild(); }
$('drink-beer').onclick = () => chooseDrink('beer'); $('drink-coffee').onclick = () => chooseDrink('coffee'); $('drink-pizza').onclick = () => chooseDrink('pizza');
$('view-map').onclick = () => showView(false); $('view-list').onclick = () => showView(true);
$('toolbar-toggle').onclick = () => {
  const collapsed = $('app').classList.toggle('toolbar-collapsed');
  $('toolbar-toggle').setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? t('Suche und Filter ausklappen') : t('Suche und Filter einklappen');
  $('toolbar-toggle').setAttribute('aria-label', label); $('toolbar-toggle').title = label;
  if (collapsed) {
    closeSearchSuggestions();
    $('filters').hidden = true; $('filters-toggle').setAttribute('aria-expanded', 'false');
  }
};
$('search').oninput = event => {
  clearTimeout(searchZoomTimer);
  cancelAddressRequest(); clearAddressSelection();
  f.query = $<HTMLInputElement>('search').value;
  selected = undefined; activeSuggestion = -1; searchOpen = true;
  render();
  if (!(event as InputEvent).isComposing && f.query.trim().length >= 2) {
    searchZoomTimer = setTimeout(zoomToSearchResults, 350);
    scheduleAddressSearch();
  }
};
$('search').onfocus = () => { searchOpen = true; renderSearchSuggestions(); if (!addressSelection && addressStatus === 'idle') scheduleAddressSearch(); };
$('search-clear').onpointerdown = event => event.preventDefault();
$('search-clear').onclick = () => {
  clearTimeout(searchZoomTimer);
  cancelAddressRequest(); clearAddressSelection();
  closeSearchSuggestions();
  f.query = ''; selected = undefined;
  render();
  $('search').focus({ preventScroll: true });
};
$('search').onblur = () => { cancelAddressRequest(); closeSearchSuggestions(); };
$('search').onkeydown = async event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { clearTimeout(searchZoomTimer); cancelAddressRequest(); closeSearchSuggestions(); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); searchOpen = true;
    renderSearchSuggestions();
    if (!suggestions.length) return;
    activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : activeSuggestion < 0 ? 0 : -1) + suggestions.length) % suggestions.length;
    renderSearchSuggestions();
    $(`search-option-${activeSuggestion}`).scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault(); clearTimeout(searchZoomTimer);
    if (searchOpen && activeSuggestion >= 0) selectSearchSuggestion(activeSuggestion);
    else if (searchOpen && suggestions.length && (!/\d/.test(f.query) || addressStatus === 'ready')) selectSearchSuggestion(0);
    else {
      const query = f.query;
      searchOpen = true;
      const pending = loadAddressResults(), request = addressRequest;
      await pending;
      if (searchOpen && f.query === query && request === addressRequest) {
        if (suggestions.length) selectSearchSuggestion(0);
        else zoomToSearchResults();
      }
    }
  }
};
$('price').oninput = () => { cheapMode = false; const n = $<HTMLInputElement>('price').valueAsNumber; f.max = Number.isFinite(n) ? n : Infinity; render(); };
$('volume').onchange = () => { selectBeerSize(f, $<HTMLSelectElement>('volume').value); render(); };
$('coffeeType').onchange = () => { f.coffeeType = $<HTMLSelectElement>('coffeeType').value; render(); };
$('beer-type').onchange = () => {
  f.beerType = $<HTMLSelectElement>('beer-type').value as Filters['beerType'];
  if (f.beerType === 'draft') selectBeerSize(f, 'stange');
  else if (['bottle', 'can'].includes(f.beerType!) && f.volume === 'stange') f.volume = 'all';
  render();
};
$('type').onchange = () => { f.type = $<HTMLSelectElement>('type').value; render(); };
$('sort').onchange = () => { f.sort = $<HTMLSelectElement>('sort').value; if (f.sort === 'distance' && !position && !addressSelection) locate(); else render(); };
for (const [id, key] of [['unknown', 'unknown'], ['outdoor', 'outdoor'], ['alcohol-free', 'alcoholFree']] as const) $(id).onchange = () => { if (key === 'unknown') cheapMode = false; f[key] = $<HTMLInputElement>(id).checked; render(); };
$('normalize').onchange = () => { f.mode = $<HTMLInputElement>('normalize').checked ? 'half' : 'glass'; render(); };
$('filters-toggle').onclick = () => { $('filters').hidden = !$('filters').hidden; $('filters-toggle').setAttribute('aria-expanded', String(!$('filters').hidden)); };
$('reset').onclick = () => {
  cancelAddressRequest(); clearAddressSelection();
  clearTimeout(searchZoomTimer); closeSearchSuggestions();
  cheapMode = false;
  districtState.enabled = false; districtState.selected = undefined;
  Object.assign(f, { query: '', max: pizza() ? 30 : 15, volume: '300-330', coffeeType: 'cappuccino', beerType: 'all', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' });
  $<HTMLInputElement>('search').value = ''; $<HTMLInputElement>('price').value = String(f.max);
  $<HTMLSelectElement>('type').value = ''; $<HTMLSelectElement>('sort').value = 'price';
  for (const id of ['unknown', 'outdoor', 'alcohol-free']) $<HTMLInputElement>(id).checked = id === 'unknown';
  render();
};
let locating = false;
function locate(openNearby = false) {
  if (!navigator.geolocation) return toast(t('Standort wird von diesem Browser nicht unterstützt.'));
  if (locating) return;
  locating = true;
  const button = $<HTMLButtonElement>('locate');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const finish = () => { locating = false; button.disabled = false; button.removeAttribute('aria-busy'); };
  navigator.geolocation.getCurrentPosition(p => {
    finish();
    if (addressSelection) f.query = '';
    cancelAddressRequest(); clearAddressSelection();
    position = [p.coords.latitude, p.coords.longitude];
    button.setAttribute('aria-pressed', 'true');
    userMarker?.remove(); userMarker = L.circleMarker(position, { radius: 7, color: '#fff', fillColor: '#1766c2', fillOpacity: 1, weight: 2 }).addTo(map);
    clearTimeout(searchZoomTimer);
    if (openNearby) { selected = undefined; pendingReveal = undefined; }
    map.setView(position, Math.max(map.getZoom(), 18)); render();
    // Without the full catalogue, a missing neighbour could look unambiguous.
    const nearby = openNearby && locationCatalogue.length
      ? locationAtPosition(selectableLocations(bars, selectableLocations(venues, locationCatalogue)), position, p.coords.accuracy)
      : undefined;
    if (nearby && isVenueEligible(nearby, f) && inSelectedDistrict(nearby)) showBar(nearby);
  }, () => { finish(); if (f.sort === 'distance') { f.sort = 'price'; $<HTMLSelectElement>('sort').value = 'price'; } toast(t('Standort nicht verfügbar.')); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
}
$('locate').onclick = () => locate(true);
$('cheap').onclick = () => {
  cheapMode = !cheapMode;
  trackEvent(cityId, 'cheap_filter_changed', { category: f.drink!, enabled: cheapMode });
  selected = undefined;
  render();
};
$('data-info').onclick = () => {
  $('coverage').textContent = Object.entries(datasets).map(([drink, data]) => t('{category}: {offers} Angebote aus Karten bei {venues} Lokalen', {
    category: drink === 'pizza' ? 'Pizza Margherita' : drink === 'beer' ? t('Bier') : t('Kaffee'),
    offers: data.bars.reduce((n, b) => n + b.offers.length, 0), venues: data.bars.filter(b => b.offers.length).length,
  })).join('. ') + `. ${t('{count} gemeinsame Einträge/Korrekturen.', { count: entries.length })}`;
  $<HTMLDialogElement>('info').showModal();
};
for (const format of ['csv', 'json'] as const) {
  $('download-' + format).onclick = () => {
    downloadExport(createExport(cityId, datasets, entries, communityReady, undefined, addedVenues), format);
    trackEvent(cityId, 'data_downloaded', { format });
  };
}
$('close-info').onclick = () => $<HTMLDialogElement>('info').close();
$('close-share').onclick = () => $<HTMLDialogElement>('share-dialog').close();
$('share-url').onclick = () => $<HTMLInputElement>('share-url').select();

function entryFields() {
  const category = $<HTMLSelectElement>('entry-drink').value;
  const isCoffee = category === 'coffee';
  const isBeer = category === 'beer';
  const name = $<HTMLInputElement>('entry-name');
  name.readOnly = category === 'pizza';
  if (category === 'pizza') name.value = 'Pizza Margherita';
  else if (name.value === 'Pizza Margherita') name.value = '';
  name.placeholder = category === 'coffee' ? t('z. B. Espresso') : t('z. B. Lager');
  const packaged = ['bottle', 'can'].includes($<HTMLSelectElement>('entry-beer-type').value);
  if (packaged) { $<HTMLInputElement>('entry-stange').checked = false; $<HTMLInputElement>('entry-size-unknown').checked = false; }
  $<HTMLInputElement>('entry-size-unknown').disabled = packaged;
  const unknown = $<HTMLInputElement>('entry-size-unknown').checked;
  $('entry-coffee-label').hidden = !isCoffee; $('entry-beer-fields').hidden = !isBeer;
  $<HTMLInputElement>('entry-volume').disabled = !isBeer || unknown;
  $<HTMLInputElement>('entry-volume').required = isBeer && !unknown;
  if (unknown) $<HTMLInputElement>('entry-stange').checked = true;
  $<HTMLInputElement>('entry-stange').disabled = unknown || packaged;
}
function openPrice(bar: Bar, offer?: Offer) {
  if (!communityReady) return toast(t('Gemeinsame Preise sind gerade nicht verfügbar. Bitte neu laden.'));
  map.closePopup();
  editing = offer;
  $<HTMLFormElement>('price-form').reset();
  $('form-title').textContent = offer ? t('Preis ändern') : t('Preise hinzufügen');
  $('menu-scan').hidden = Boolean(offer);
  $<HTMLDetailsElement>('manual-entry').open = Boolean(offer);
  $('scan-status').hidden = true;
  $<HTMLInputElement>('entry-bar').value = bar.id;
  $('entry-location').textContent = t('Die Preise werden diesem Lokal zugeordnet.');
  $<HTMLInputElement>('entry-bar-name').value = [bar.name, bar.address].filter(Boolean).join(' · ');
  $<HTMLSelectElement>('entry-drink').value = offer ? offerCategory(offer) : f.drink!;
  $<HTMLSelectElement>('entry-drink').disabled = Boolean(offer);
  $<HTMLSelectElement>('entry-coffee').value = offer?.coffeeType || (f.coffeeType === 'all' ? 'cappuccino' : f.coffeeType!);
  $<HTMLInputElement>('entry-name').value = offer?.name || (coffee() ? coffeeLabels[$<HTMLSelectElement>('entry-coffee').value] : '');
  $<HTMLInputElement>('entry-price').value = offer ? String(offer.priceChf) : '';
  $<HTMLInputElement>('entry-volume').value = String(offer?.volumeMl ? offer.volumeMl / 100 : ['stange', '300-330'].includes(f.volume) ? 3 : f.volume === 'all' ? 5 : Number(f.volume) / 100);
  $<HTMLInputElement>('entry-stange').checked = offer?.serving === 'stange' || (!offer && f.volume === 'stange');
  $<HTMLInputElement>('entry-size-unknown').checked = Boolean(offer && offerCategory(offer) === 'beer' && offer.volumeMl === null);
  $<HTMLSelectElement>('entry-beer-type').value = offer ? effectiveBeerType(offer) : 'draft';
  $('entry-type-hint').hidden = !offer?.beerTypeEstimate || Boolean(offer.beerType && offer.beerType !== 'unknown');
  $<HTMLInputElement>('entry-alcohol').checked = offer?.alcoholFree ?? f.alcoholFree;
  $<HTMLInputElement>('entry-date').value = zurichToday(); $<HTMLInputElement>('entry-date').max = zurichToday();
  $<HTMLInputElement>('entry-source').value = offer?.sourceUrl || '';
  $('form-error').hidden = true;
  entryFields();
  $<HTMLDialogElement>('price-dialog').showModal();
  trackEvent(cityId, 'price_form_opened', { category: offer ? offerCategory(offer) : f.drink!, action: offer ? 'edit' : 'add' });
  // Focus the heading even when reopening after typing; inputs must never open
  // the phone keyboard until the visitor explicitly taps a field.
  $('form-title').focus({ preventScroll: true });
}
$('scan-menu').onclick = () => { if (!saving) $<HTMLInputElement>('menu-photo').click(); };
$('menu-photo').onchange = async () => {
  const picker = $<HTMLInputElement>('menu-photo');
  const file = picker.files?.[0];
  if (!file || saving) return;
  const barId = $<HTMLInputElement>('entry-bar').value;
  let stage: 'preparation' | 'request' = 'preparation';
  let completed = false;
  trackEvent(cityId, 'menu_upload_started', {});
  saving = true;
  $<HTMLButtonElement>('scan-menu').disabled = true;
  $<HTMLButtonElement>('cancel-price').disabled = true;
  $<HTMLFieldSetElement>('manual-fields').disabled = true;
  $('menu-scan').setAttribute('aria-busy', 'true');
  $('form-error').hidden = true;
  $('scan-status').hidden = false; $('scan-status').textContent = t('Foto wird vorbereitet …');
  try {
    const image = await prepareMenuPhoto(file);
    stage = 'request';
    $('scan-status').textContent = t('Karte wird gelesen und Preise werden gespeichert …');
    const response = await fetch(`/api/scan-menu?city=${cityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barId, image }), signal: AbortSignal.timeout(100000) });
    const result = await response.json().catch(() => { throw new Error(t('Der Scan ist gerade nicht verfügbar. Bitte später erneut versuchen.')); });
    if (!response.ok) throw new Error(result.error || t('Das Foto konnte nicht verarbeitet werden.'));
    const scanned = result as MenuScanResult;
    const { added, unchanged, conflicts, skipped } = scanned;
    completed = true;
    trackEvent(cityId, 'menu_upload_completed', { added, unchanged, conflicts, skipped });
    const ids = new Set(scanned.entries.map(entry => entry.id));
    entries = [...entries.filter(entry => !ids.has(entry.id)), ...scanned.entries];
    if (scanned.entries.length && !scanned.entries.some(entry => entry.drink === f.drink)) f.drink = scanned.entries[0].drink;
    cheapMode = false; selected = barId;
    $<HTMLDialogElement>('price-dialog').close(); rebuild();
    const bar = bars.find(b => b.id === barId) || locationCatalogue.find(b => b.id === barId);
    if (bar) showBar(bar);
    toast(scanSummary(scanned));
  } catch (error) {
    if (!completed) trackEvent(cityId, 'menu_upload_failed', { stage });
    $('scan-status').hidden = true;
    $('form-error').textContent = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
      ? t(error.message) : t('Verbindung unterbrochen. Bitte lade die Seite neu, um bereits gespeicherte Preise zu sehen.');
    $('form-error').hidden = false;
  } finally {
    saving = false; picker.value = '';
    $<HTMLButtonElement>('scan-menu').disabled = false;
    $<HTMLButtonElement>('cancel-price').disabled = false;
    $<HTMLFieldSetElement>('manual-fields').disabled = false;
    $('menu-scan').removeAttribute('aria-busy');
  }
};
$('entry-drink').onchange = () => {
  if (!editing) $<HTMLInputElement>('entry-name').value = $<HTMLSelectElement>('entry-drink').value === 'coffee' ? coffeeLabels[$<HTMLSelectElement>('entry-coffee').value] : '';
  entryFields();
};
$('entry-coffee').onchange = () => { if (!editing) $<HTMLInputElement>('entry-name').value = coffeeLabels[$<HTMLSelectElement>('entry-coffee').value]; };
 $('entry-size-unknown').onchange = entryFields;
$('entry-beer-type').onchange = entryFields;
$('cancel-price').onclick = () => { if (!saving) $<HTMLDialogElement>('price-dialog').close(); };
$('price-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('price-form').onsubmit = async event => {
  event.preventDefault(); if (saving) return;
  $('form-error').hidden = true;
  const drink = $<HTMLSelectElement>('entry-drink').value as Drink;
  const action = editing ? 'edit' : 'add';
  let stage: 'validation' | 'request' = 'validation';
  let saved = false;
  try {
    const input = validateInput({
      id: editing?.communityId, revision: editing?.revision || 0, targetKey: editing ? editing.originalKey || offerKey(editing) : undefined,
      barId: $<HTMLInputElement>('entry-bar').value, drink,
      name: $<HTMLInputElement>('entry-name').value, priceChf: $<HTMLInputElement>('entry-price').valueAsNumber,
      volumeMl: drink !== 'beer' || $<HTMLInputElement>('entry-size-unknown').checked ? null : $<HTMLInputElement>('entry-volume').valueAsNumber * 100,
      beerType: drink === 'beer' ? $<HTMLSelectElement>('entry-beer-type').value as BeerType : undefined,
      coffeeType: drink === 'coffee' ? $<HTMLSelectElement>('entry-coffee').value : undefined,
      pizzaType: drink === 'pizza' ? 'margherita' : undefined,
      serving: drink === 'beer' && $<HTMLInputElement>('entry-stange').checked ? 'stange' : undefined,
      alcoholFree: drink !== 'beer' || $<HTMLInputElement>('entry-alcohol').checked,
      observedAt: $<HTMLInputElement>('entry-date').value, sourceUrl: $<HTMLInputElement>('entry-source').value,
    } satisfies PriceInput, selectableLocations(venues, locationCatalogue).filter(b => matchesVenueType(b, f) && inSelectedDistrict(b)));
    stage = 'request';
    trackEvent(cityId, 'price_submitted', { category: drink, action });
    saving = true; $<HTMLButtonElement>('scan-menu').disabled = true; $<HTMLButtonElement>('save-price').disabled = true; $<HTMLButtonElement>('cancel-price').disabled = true; $('save-price').textContent = t('Speichern …');
    const response = await fetch(pricesApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
    const result = await response.json().catch(() => { throw new Error(t('Speichern gerade nicht möglich. Bitte erneut versuchen.')); });
    if (!response.ok) {
      if (response.status === 409 && await loadCommunity()) rebuild();
      throw new Error(result.error || t('Speichern fehlgeschlagen.'));
    }
    const entry = result.entry as PriceEntry;
    saved = true;
    trackEvent(cityId, 'price_saved', { category: drink, action });
    entries = [...entries.filter(x => x.id !== entry.id), entry];
    cheapMode = false;
    f.drink = drink; selected = input.barId;
    // Keep the saved portion visible even if it differs from the current filter.
    f.mode = 'glass'; f.alcoholFree = input.alcoholFree;
    if (drink === 'coffee') {
      f.coffeeType = input.coffeeType;
    }
    else if (drink === 'beer') { f.volume = input.serving === 'stange' ? 'stange' : String(input.volumeMl); f.beerType = input.beerType || 'unknown'; }
    if (!Array.from($<HTMLSelectElement>('volume').options).some(x => x.value === f.volume)) f.volume = 'all';
    f.max = Math.max(f.max, input.priceChf); $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : '';
    $<HTMLInputElement>('alcohol-free').checked = f.alcoholFree;
    $<HTMLDialogElement>('price-dialog').close(); rebuild(); showView(false);
    const bar = bars.find(b => b.id === input.barId); if (bar) showBar(bar, 16);
    toast(t('Gespeichert. Für alle sichtbar.'));
  } catch (error) {
    if (!saved) trackEvent(cityId, 'price_failed', { category: drink, action, stage });
    $('form-error').textContent = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name) ? t(error.message) : t('Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.');
    $('form-error').hidden = false;
  } finally { saving = false; $<HTMLButtonElement>('scan-menu').disabled = false; $<HTMLButtonElement>('save-price').disabled = false; $<HTMLButtonElement>('cancel-price').disabled = false; $('save-price').textContent = t('Speichern'); }
};
async function loadCommunity() {
  try {
    const response = await fetch(pricesApi, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!Array.isArray(result.entries)) throw new Error();
    entries = result.entries; addedVenues = Array.isArray(result.venues) ? result.venues : []; communityReady = true;
    return true;
  } catch { communityReady = false; return false; }
}
async function init() {
  const [beerResult, coffeeResult, pizzaResult, loadedCommunity, locationsResult] = await Promise.all([
    fetch(`${dataPath}bars.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    fetch(`${dataPath}coffee.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    fetch(`${dataPath}pizza.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    loadCommunity(),
    fetch(`${dataPath}locations.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
  ]);
  if (beerResult) datasets.beer = beerResult;
  if (coffeeResult) datasets.coffee = coffeeResult;
  if (pizzaResult) datasets.pizza = pizzaResult;
  locationCatalogue = locationsResult?.bars || [];
  const missing = [!beerResult ? t('Bier') : '', !coffeeResult ? t('Kaffee') : '', !pizzaResult ? 'Pizza' : '', !loadedCommunity ? t('gemeinsame Einträge') : ''].filter(Boolean);
  const hasData = Object.keys(datasets).length > 0;
  for (const format of ['csv', 'json']) $<HTMLButtonElement>('download-' + format).disabled = !hasData;
  $('download-status').textContent = !hasData ? t('Download nicht verfügbar. Bitte lade die Seite erneut.') : missing.length ? t('Unvollständiger Export: {missing} konnten nicht geladen werden. Bitte lade die Seite erneut für einen vollständigen Export.', { missing: missing.join(', ') }) : t('Gemeinsame Einträge und Korrekturen sind enthalten.');
  $<HTMLInputElement>('price').value = String(f.max);
  const errors = [!beerResult ? t('Bierdaten konnten nicht geladen werden.') : '', !coffeeResult ? t('Kaffeedaten konnten nicht geladen werden.') : '', !pizzaResult ? t('Pizzadaten konnten nicht geladen werden.') : '', !locationsResult ? t('Zusätzliche Kartenlokale konnten nicht geladen werden. Bitte neu laden.') : ''].filter(Boolean);
  if (errors.length) { $('load-error').textContent = errors.join(' '); $('load-error').hidden = false; }
  rebuild();
  const linkedId = initial.get('bar');
  if (linkedId) {
    const linkedBar = bars.find(b => b.id === linkedId);
    if (linkedBar) showBar(linkedBar);
    else toast(t('Das geteilte Lokal ist gerade nicht verfügbar.'));
  } else if (f.query.trim()) {
    zoomToSearchResults(); searchOpen = true;
    if (initial.get('address') === '1') {
      const query = f.query;
      await loadAddressResults();
      if (searchOpen && f.query === query && addressResults.length) {
        selectSearchSuggestion(suggestions.findIndex(result => result === addressResults[0]));
      }
    } else scheduleAddressSearch();
  }
}
syncControls();
void init();
if (districtState.enabled) {
  $('filters').hidden = false; $('filters-toggle').setAttribute('aria-expanded', 'true');
  void loadDistricts();
}
