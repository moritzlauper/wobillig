import { cities, cityFromPath, cityLink, type City } from './cities';
import L from 'leaflet';
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
import { prepareMenuPhoto, scanSummary, type MenuScanResult } from './menu-scan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => n.toFixed(2);
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => `<option value="${value}">${e(label)}</option>`).join('');
const coffeeOptions = options(coffeeLabels);
const venueTypes = { '': 'Alle (ohne Imbiss)', all: 'Alle (inkl. Imbiss)', bar: 'Bar / Pub', restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Imbiss' };
const cityId = cityFromPath(location.pathname, import.meta.env.BASE_URL);
const city = cities[cityId];
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
let userMarker: L.CircleMarker | undefined;
let suggestions: Bar[] = [], activeSuggestion = -1, searchOpen = false;
let searchZoomTimer: ReturnType<typeof setTimeout> | undefined;
const coffee = () => f.drink === 'coffee';
const pizza = () => f.drink === 'pizza';
const beer = () => f.drink === 'beer';
const budgets: Record<Drink, number> = { beer: 15, coffee: 15, pizza: 30 };
const unit = (o: Offer) => offerCategory(o) !== 'beer' ? portion(o) : `${f.mode === 'half' ? `5 dl${o.volumeMl === 500 ? '' : ' · umgerechnet'}` : portion(o)} · ${beerTypeLabel(o)}`;

$('app').innerHTML = `
<div class="toolbar">
  <div class="toolbar-heading"><div class="switch" role="group" aria-label="Kategorie"><button id="drink-coffee">Kaffee</button><button id="drink-beer">Bier</button><button id="drink-pizza" aria-label="Pizza Margherita" hidden>Pizza<span class="category-description"> Margherita</span></button></div><button id="toolbar-toggle" aria-expanded="true" aria-label="Suche und Filter einklappen" title="Suche und Filter einklappen"><span class="filter-chevron" aria-hidden="true"></span></button></div>
  <div class="search-box">
    <input id="search" type="search" role="combobox" placeholder="Lokal, Strasse, PLZ" aria-label="Lokal suchen" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="search-suggestions">
    <button id="search-clear" type="button" aria-label="Suche löschen" title="Suche löschen" hidden><span aria-hidden="true">×</span></button>
    <div id="search-dropdown" hidden><div id="search-suggestions" role="listbox" aria-label="Suchvorschläge"></div><p id="search-empty" role="status" hidden>Keine Lokale gefunden. Prüfe den Suchbegriff und die Kreisauswahl.</p></div>
  </div>
  <div id="beer-controls" class="beer-controls">
    <select id="beer-type" aria-label="Ausschank">${options({ draft: 'Offenbier', bottle: 'Flaschenbier', all: 'Alle Ausschankarten', can: 'Dosenbier', unknown: 'Unbekannt' })}</select>
    <select id="volume" aria-label="Biergrösse">${options({ stange: 'Stange / 3 dl', '300-330': '3 / 3.3 dl', '500': '5 dl', '330': '3.3 dl', '400': '4 dl', all: 'Alle Grössen' })}</select>
  </div>
  <select id="coffeeType" aria-label="Kaffeesorte oder Matcha Latte" hidden><option value="all">Alle Kaffees &amp; Matcha Latte</option>${coffeeOptions}</select>
  <label class="budget">Bis CHF <input id="price" aria-label="Höchstpreis in CHF" type="number" min="0.5" max="50" step="0.5" value="15"></label>
  <button id="filters-toggle" aria-expanded="false" aria-controls="filters">Filter <span class="filter-chevron" aria-hidden="true"></span></button>
</div>
<div id="filters" hidden>
  <label>Lokal <select id="type">${options(venueTypes)}</select></label>
  <label><input id="unknown" type="checkbox" checked> Ohne passenden Preis anzeigen</label>
  <label><input id="outdoor" type="checkbox"> Draussen sitzen</label>
  <label id="alcohol-label"><input id="alcohol-free" type="checkbox"> Alkoholfrei</label>
  <label id="normalize-label"><input id="normalize" type="checkbox"> Auf 5 dl umrechnen</label>
  ${cityId === 'zurich' ? '<label><input id="district-toggle" type="checkbox" aria-controls="district-select-label"> Kreise anzeigen</label><label id="district-select-label" hidden>Kreis <select id="district-select" aria-label="Zürcher Stadtkreis"><option value="">Alle Kreise</option></select></label>' : ''}
  <button id="reset">Zurücksetzen</button>
</div>
<div class="status-row"><div class="status-summary" role="status"><strong id="city-average">Schnitt ${e(city.name)} —</strong><strong id="district-average" hidden></strong><span id="count">Laden …</span></div><div class="mobile-switch" role="group" aria-label="Ansicht"><button id="view-map" aria-pressed="true">Karte</button><button id="view-list" aria-pressed="false">Liste</button></div><div class="status-meta"><small class="refresh-note">Wird alle 3 Wochen aktualisiert</small><nav class="city-switch" aria-label="Stadt wechseln">${(Object.keys(cities) as City[]).map(id => `<a data-city="${id}" href="${e(cityLink(id, location.search, import.meta.env.BASE_URL))}"${id === cityId ? ' aria-current="page"' : ''}>${cities[id].name}</a>`).join('<span aria-hidden="true">/</span>')}</nav><button id="data-info" class="text-button">Daten</button></div></div>
<div id="load-error" role="status" hidden></div>
<main>
  <aside class="list-panel" aria-label="Lokale"><div class="list-tools"><a class="rankings-link" href="#kaffeepreise" aria-label="Kaffee-Ranglisten und Quellen" title="Kaffee-Ranglisten und Quellen">Ranglisten</a><select id="sort" aria-label="Sortierung">${options({ price: 'Preis aufsteigend', price_desc: 'Preis absteigend', name: 'Name A–Z', distance: 'Entfernung' })}</select></div><div id="results"></div></aside>
  <section class="map-panel" aria-label="Karte"><div id="map"></div><div class="map-actions"><button id="locate" aria-pressed="false" aria-label="Standort anzeigen" title="Standort anzeigen"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg></button><button id="cheap" aria-pressed="false" disabled>Günstig</button></div><section id="detail" aria-label="Lokal und Preise" tabindex="-1" hidden></section>
<footer class="app-footer"><a href="mailto:team@whatshouldistudy.com?subject=Wunsch%20f%C3%BCr%20wobillig&amp;body=f%C3%BCr%20wobillig%20w%C3%BCnsche%20ich%20mir%3A%0D%0A%0D%0A">Wunsch mitteilen</a></footer>
  </section>
</main>
<div id="toast" role="status" hidden></div>
<dialog id="share-dialog" aria-labelledby="share-title"><div class="dialog-top"><strong id="share-title">Lokal teilen</strong><button id="close-share" type="button">Schliessen</button></div><label for="share-url">Diesen Link kopieren und teilen:</label><input id="share-url" type="url" readonly></dialog>
<dialog id="price-dialog" aria-label="Preis eintragen"><form id="price-form">
  <div class="dialog-top"><strong id="form-title" tabindex="-1" autofocus>Preis eintragen</strong><button id="cancel-price" type="button">Schliessen</button></div>
  <input id="entry-bar" type="hidden">
  <label>Lokal<input id="entry-bar-name" readonly></label><p id="entry-location" class="muted"></p>
  <section id="menu-scan" class="menu-scan" aria-label="Karte scannen">
    <button id="scan-menu" class="primary" type="button">Karte scannen / hochladen</button>
    <input id="menu-photo" type="file" accept="image/*" aria-label="Menüfoto auswählen" hidden>
    <p class="muted">Foto aufnehmen oder auswählen. Lesbare Bier-, Kaffee- und Margherita-Preise werden automatisch gespeichert.</p>
    <p class="scan-privacy">Das Foto wird zur Erkennung an Anthropic gesendet und von wobillig nicht gespeichert.</p>
    <p id="scan-status" role="status" hidden></p>
  </section>
  <details id="manual-entry"><summary>Preis von Hand eintragen</summary><fieldset id="manual-fields">
  <div class="form-row"><label>Kategorie<select id="entry-drink"><option value="coffee">Kaffee</option><option value="beer">Bier</option><option value="pizza">Pizza Margherita</option></select></label><label id="entry-coffee-label" hidden>Sorte<select id="entry-coffee">${coffeeOptions}</select></label></div>
  <label>Bezeichnung<input id="entry-name" maxlength="100" placeholder="z. B. Lager oder Espresso" required></label>
  <div id="entry-beer-fields"><label>Ausschank<select id="entry-beer-type">${options(beerTypeLabels)}</select></label><small id="entry-type-hint" class="muted" hidden>Diese Vorauswahl ist geschätzt. Bitte prüfen.</small><div class="form-row"><label>Menge in dl<input id="entry-volume" type="number" min="1" max="10" step="0.01" value="5"></label><label class="inline-check"><input id="entry-stange" type="checkbox"> Stange</label></div><label class="check"><input id="entry-size-unknown" type="checkbox"> Menge nicht angegeben (nur Stange)</label><label class="check"><input id="entry-alcohol" type="checkbox"> Alkoholfrei</label></div>
  <div class="form-row"><label>Preis in CHF<input id="entry-price" type="number" min="0.5" max="50" step="0.01" inputmode="decimal" required></label><label>Preis gesehen am<input id="entry-date" type="date" min="2020-01-01" required></label></div>
  <label>Link zur Karte (optional)<input id="entry-source" type="url" maxlength="1500" placeholder="https://…"></label>
  <p class="muted">Wird für alle sichtbar. Bitte den tatsächlichen Preis dieser Portion eintragen.</p>
  <button id="save-price" class="primary" type="submit">Speichern</button>
  </fieldset></details>
  <p id="form-error" role="alert" hidden></p>
</form></dialog>
<dialog id="info" aria-label="Daten"><div class="dialog-top"><strong>Daten</strong><button id="close-info">Schliessen</button></div><section class="data-download" aria-labelledby="download-title"><strong id="download-title">Daten für ${e(city.name)} herunterladen</strong><p>Alle erfassten Angebote für Bier, Kaffee und Pizza, unabhängig von deinen Filtern. Mit Originalpreisen in CHF, Mengen, Quellen, Datum und Prüfstatus sowie verfügbaren gemeinsamen Korrekturen.</p><div class="download-actions"><button id="download-csv" class="primary" disabled>CSV herunterladen</button><button id="download-json" disabled>JSON herunterladen</button></div><p class="muted">CSV: eine Zeile pro Angebot, UTF-8, Semikolon als Trennzeichen. JSON enthält zusätzlich Lokale ohne Preis und die vollständigen Angebotsdetails. Abgelaufene Angebote sind im CSV gekennzeichnet; im JSON bleibt das Fotodatum erhalten.</p><p id="download-status" class="muted" role="status">Daten werden geladen …</p></section><p id="coverage"></p><p>Der Stadtdurchschnitt verwendet den günstigsten passenden Preis je Lokal für die gewählte Sorte, Biergrösse und Ausschankart. Alkoholfrei und die optionale Umrechnung auf 5 dl werden berücksichtigt. Suche, Preislimit, «Günstig», Lokaltyp und «Draussen sitzen» verändern diesen stadtweiten Vergleichswert nicht. Lokale ohne passenden Preis zählen nicht mit. Bei «Alle» wird das jeweils günstigste passende Angebot verwendet.</p>${cityId === 'zurich' ? '<p>Kreise: Unter «Filter» lassen sich die Stadtkreise einblenden und per Karte oder Auswahlfeld auswählen. Der Kreisdurchschnitt wird wie der Stadtdurchschnitt berechnet, jedoch nur mit Lokalen innerhalb der gewählten Kreisgrenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis. Kreisgrenzen: <a href="https://data.stadt-zuerich.ch/dataset/geo_stadtkreise" target="_blank" rel="noopener noreferrer">Stadt Zürich, Stadtkreise (CC0)</a>.</p>' : ''}<p>Preise stammen aus verlinkten Speise- und Getränkekarten oder wurden von Besuchern eingetragen. Eingetragene Preise und Foto-Uploads behalten Vorrang, ausser eine belegbar neuere Website-Karte nennt einen abweichenden Preis. Quelle, Menge und Datum stehen beim Angebot.</p><p>Pizza: Preis pro ganzer, normaler Margherita im Lokal. Grössen können je nach Restaurant abweichen. Kinderpizzen, Spezialvarianten und reine Liefer- oder Take-away-Preise sind ausgeschlossen.</p><p>Bier: Cafés ohne erfasstes Bierangebot oder mit ausschliesslicher Öffnung bis spätestens 19 Uhr werden ausgeblendet, auch bei «Ohne passenden Preis anzeigen». Unbekannte Öffnungszeiten bleiben offen.</p><p>Stange: 3 dl oder ausdrücklich als Stange bezeichnete kleine Portion; bekannte Flaschen und Dosen sind ausgeschlossen. Fehlt die Ausschankart in der Quelle, wird sie anhand von Menü, Bezeichnung und Menge geschätzt. Solche Angaben sind als «geschätzt» gekennzeichnet und zählen im Ausschank-Filter mit. Fehlende Mengen bleiben offen. Die optionale Umrechnung auf 5 dl ist ein Vergleichspreis.</p><p>Neue Einträge und Korrekturen werden gemeinsam gespeichert. Zum Begrenzen von Spam wird kurzzeitig eine nicht rücklesbare Kennung aus der IP-Adresse gespeichert. Dein Standort bleibt im Browser.</p><p>Standorte und Karte: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap-Mitwirkende, ODbL</a>.</p></dialog>`;

const map = L.map('map', { zoomControl: false }).setView(city.center, 14);
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
map.on('moveend', renderLocations);
map.on('click', event => {
  if (map.getZoom() < 17) { toast('Zum Auswählen eines Lokals näher heranzoomen.'); return; }
  const choices = nearbyLocations(selectableLocations(venues, locationCatalogue).filter(b => matchesVenueType(b, f) && inSelectedDistrict(b)), event.containerPoint, b => map.latLngToContainerPoint([b.lat, b.lon]));
  if (!choices.length) { toast('Hier wurde kein Lokal gefunden. Tippe auf das Symbol oder näher an den Namen.'); return; }
  if (choices.length === 1) { openPrice(choices[0]); return; }
  const content = document.createElement('div');
  content.className = 'location-choices';
  const title = document.createElement('strong'); title.textContent = 'Für welches Lokal?'; content.append(title);
  for (const bar of choices) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = [bar.name, bar.address].filter(Boolean).join(' · ');
    button.onclick = () => { map.closePopup(); openPrice(bar); };
    content.append(button);
  }
  L.popup().setLatLng(event.latlng).setContent(content).openOn(map);
});
// Hide labels throughout zoom gestures/animations, including touch pinch zoom.
// Toggle visibility directly so zooming does not rebuild every marker and result.
const venueNamesMinZoom = 18;
const syncVenueNames = () => $('map').classList.toggle('show-venue-names', map.getZoom() >= venueNamesMinZoom);
map.on('zoomstart', () => $('map').classList.remove('show-venue-names'));
map.on('zoomend', syncVenueNames);
syncVenueNames();
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
    toast('Kreisgrenzen konnten nicht geladen werden. Bitte «Kreise anzeigen» erneut aktivieren.');
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
    select.innerHTML = `<option value="">${districtsLoading ? 'Kreise laden …' : 'Alle Kreise'}</option>`;
    return;
  }
  if (!map.hasLayer(districtLayer)) districtLayer.addTo(map);
  const averages = new Map(districtData.features.map(d => {
    const number = d.properties.number;
    return [number, cityAverage(bars.filter(b => districtLookup!(b) === number), f)];
  }));
  const label = (number: number) => {
    const average = averages.get(number);
    return `Kreis ${number} · ${average ? `Ø CHF ${money(average.price)} (${average.count})` : 'kein passender Preis'}`;
  };
  select.innerHTML = '<option value="">Alle Kreise</option>' + districtData.features.map(d => `<option value="${d.properties.number}">${label(d.properties.number)}</option>`).join('');
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
    $('district-average').textContent = `Schnitt Kreis ${districtState.selected} ${average ? `CHF ${money(average.price)} (${average.count} Lokale)` : '— keine passenden Preise'}`;
    $('district-average').title = 'Günstigster passender Preis je Lokal im Kreis. Unabhängig von Suche, Preislimit, Günstig-Filter, Lokaltyp und Draussen-Filter.';
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
  venues = communityVenues(datasets, entries);
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
  const heading = `${beer() ? 'Bierpreise' : pizza() ? 'Pizzapreise' : 'Kaffeepreise'} ${city.name}`;
  if ($('map-title').textContent !== heading) $('map-title').textContent = heading;
  document.title = coffee() ? coffeePageTitle : `${heading} vergleichen | wobillig`;
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
  if (cityId === 'zurich' && districtState.enabled) url.searchParams.set('kreise', '1'); else url.searchParams.delete('kreise');
  if (cityId === 'zurich' && districtState.enabled && districtState.selected) url.searchParams.set('kreis', String(districtState.selected)); else url.searchParams.delete('kreis');
  if (selected) url.searchParams.set('bar', selected); else url.searchParams.delete('bar');
  history.replaceState(null, '', url);
  document.querySelectorAll<HTMLAnchorElement>('[data-city]').forEach(link => { link.href = cityLink(link.dataset.city as City, url.search, import.meta.env.BASE_URL); });
}
function selectedLocation() {
  return bars.find(b => b.id === selected) || locationCatalogue.find(b => b.id === selected);
}
function render() {
  const selection = selectedLocation();
  if (selected && (!selection || !isVenueEligible(selection, f) || !inSelectedDistrict(selection))) selected = undefined;
  syncControls();
  const districtBars = bars.filter(inSelectedDistrict);
  cheapLimit = cheapPriceLimit(districtBars, f);
  const cheapButton = $<HTMLButtonElement>('cheap');
  cheapButton.textContent = cheapLimit === undefined ? 'Günstig' : `Günstig bis CHF ${Number.isInteger(cheapLimit) ? cheapLimit : cheapLimit.toFixed(2)}`;
  cheapButton.disabled = cheapLimit === undefined && !cheapMode;
  cheapButton.setAttribute('aria-pressed', String(cheapMode));
  cheapButton.title = cheapLimit === undefined ? 'Keine passenden Preise vorhanden' : cheapMode ? 'Günstig-Filter aufheben' : 'Günstige Lokale für die aktuelle Auswahl anzeigen';
  const activeFilters = cheapMode ? { ...f, max: cheapLimit ?? -Infinity, unknown: false } : f;
  if (document.activeElement !== $('price')) $<HTMLInputElement>('price').value = Number.isFinite(activeFilters.max) && activeFilters.max > 0 ? String(activeFilters.max) : '';
  $<HTMLInputElement>('unknown').checked = activeFilters.unknown;
  current = filterBars(districtBars, activeFilters, position);
  renderDistricts();
  $('count').textContent = coverageLabel(current, f);
  const average = cityAverage(bars, f);
  $('city-average').textContent = `Schnitt ${city.name} ${average ? `CHF ${money(average.price)}` : '—'}`;
  const comparison = pizza() ? 'Pizza Margherita' : coffee() ? (f.coffeeType === 'all' ? 'alle Kaffees & Matcha Latte' : coffeeLabels[f.coffeeType!]) : `Bier · ${f.volume === 'all' ? 'alle Grössen' : f.volume === 'stange' ? 'Stange' : f.volume === '300-330' ? '3 / 3.3 dl' : `${Number(f.volume) / 100} dl`} · ${f.mode === 'half' ? 'auf 5 dl umgerechnet' : 'Portionspreis'}`;
  $('city-average').title = average
    ? `${comparison}: Durchschnitt des günstigsten passenden Preises pro Lokal (${average.count} Lokale). Stadtweit, unabhängig von Suche, Preislimit, Günstig-Filter, Lokaltyp und Draussen-Filter.`
    : `${comparison}: Noch keine passenden Preise für den Stadtdurchschnitt vorhanden.`;
  $('results').innerHTML = current.length ? current.map(b => {
    const o = bestOffer(b, f);
    return `<button class="venue ${selected === b.id ? 'selected' : ''}" data-bar="${e(b.id)}"><span><strong>${e(b.name)}</strong><small>${e(b.address || b.postcode || city.name)}</small>${o ? `<small>${e(unit(o))}</small>` : ''}</span><span class="venue-price">${o ? money(cost(o, f.mode)) : `<small>${missingPriceLabel(b, f)}</small>`}</span></button>`;
  }).join('') : '<p class="empty">Keine passenden Lokale.</p>';
  layer.clearLayers();
  const selectedBar = selectedLocation();
  const mapped = selectedBar && !current.includes(selectedBar) ? [...current, selectedBar] : current;
  for (const b of mapped) {
    const o = bestOffer(b, f);
    const label = `${b.name}: ${o ? `CHF ${money(cost(o, f.mode))} / ${unit(o)}` : 'kein passender Preis'}`;
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
function searchCandidates() { return bars.filter(b => isVenueEligible(b, f) && inSelectedDistrict(b)); }
function closeSearchSuggestions() {
  searchOpen = false; activeSuggestion = -1; suggestions = [];
  $('search-dropdown').hidden = true;
  $('search').setAttribute('aria-expanded', 'false');
  $('search').removeAttribute('aria-activedescendant');
}
function renderSearchSuggestions() {
  if (!searchOpen || !f.query.trim()) { closeSearchSuggestions(); return; }
  suggestions = searchSuggestions(searchCandidates(), f.query);
  if (activeSuggestion >= suggestions.length) activeSuggestion = -1;
  $('search-dropdown').hidden = false;
  $('search').setAttribute('aria-expanded', 'true');
  $('search-empty').hidden = suggestions.length > 0;
  const visible = new Set(current.map(b => b.id));
  $('search-suggestions').innerHTML = suggestions.map((b, index) => {
    const offer = bestOffer(b, f);
    return `<button type="button" role="option" tabindex="-1" id="search-option-${index}" data-suggestion="${index}" aria-selected="${index === activeSuggestion}"><strong>${e(b.name)}</strong><small>${e([b.address, b.postcode].filter(Boolean).join(' · ') || city.name)}</small><small>${offer ? `CHF ${money(cost(offer, f.mode))} · ${e(unit(offer))}` : missingPriceLabel(b, f)}${visible.has(b.id) ? '' : ' · ausserhalb der aktuellen Filter'}</small></button>`;
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
  const matches = current.length ? current : searchSuggestions(searchCandidates(), f.query, Infinity);
  if (matches.length === 1) map.setView([matches[0].lat, matches[0].lon], 17);
  else if (matches.length) map.fitBounds(L.latLngBounds(matches.map(b => [b.lat, b.lon] as [number, number])), { padding: [45, 60], maxZoom: 17 });
}
function selectSearchSuggestion(index: number) {
  const bar = suggestions[index];
  if (!bar) return;
  clearTimeout(searchZoomTimer);
  closeSearchSuggestions();
  f.query = bar.name;
  $('search').blur();
  if (matchMedia('(max-width: 760px)').matches) {
    $('filters').hidden = true; $('filters-toggle').setAttribute('aria-expanded', 'false');
  }
  showBar(bar, 17);
}
function renderLocations() {
  locationLayer.clearLayers();
  if (map.getZoom() < 17) return;
  const displayed = new Set([...current.map(b => b.id), ...(selected ? [selected] : [])]);
  for (const bar of selectableLocations(venues, locationCatalogue).filter(b => matchesVenueType(b, f) && inSelectedDistrict(b))) {
    if (displayed.has(bar.id) || !map.getBounds().pad(.1).contains([bar.lat, bar.lon])) continue;
    const label = `${bar.name}: Preis eintragen`;
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
  $('detail').innerHTML = `<div class="detail-top"><strong>${e(b.name)}</strong><button id="close-detail">Schliessen</button></div><p class="muted">${e(b.address ? [b.address, b.postcode].filter(Boolean).join(' ') : 'Adresse noch nicht erfasst')}</p><div class="detail-actions"><button id="add-here" class="primary">Preis hinzufügen</button><button id="share-bar" aria-label="${e(b.name)} teilen">Teilen</button></div>${offers.length ? offers.map((o, i) => `<div class="offer ${matches.includes(o) ? '' : 'other-offer'}"><div class="offer-top"><strong>${e(o.name)}</strong><strong class="nowrap">CHF ${money(o.priceChf)}</strong></div><div class="muted">${e(portion(o))}${offerCategory(o) === 'beer' ? ' · ' + e(beerTypeLabels[effectiveBeerType(o)]) : ''}${offerCategory(o) === 'beer' && o.alcoholFree ? ' · alkoholfrei' : ''}${!matches.includes(o) ? ' · ausserhalb Filter' : ''}</div>${offerCategory(o) === 'beer' && o.beerTypeEstimate && (!o.beerType || o.beerType === 'unknown') ? `<details class="estimate muted"><summary>geschätzt</summary><p>${e(o.beerTypeEstimate.reason)}</p></details>` : ''}<div class="offer-meta"><span>${o.photoSource ? `Google-Maps-Foto · ${e(o.photoSource.date)} · ` : ''}${o.menuScan ? 'Foto-Upload' : o.confidence === 'community' ? 'Eingetragen' : o.confidence === 'reviewed' ? 'Manuell geprüft' : o.confidence === 'ai' ? 'KI-erkannt' : 'Automatisch erkannt'} · ${e(new Date(o.verifiedMenuDate?.date || o.observedAt).toLocaleDateString('de-CH'))}</span>${safeUrl(o.sourceUrl) ? `<a href="${safeUrl(o.sourceUrl)}" target="_blank" rel="noopener noreferrer">Quelle</a>` : ''}<button data-edit="${i}">Ändern</button></div></div>`).join('') : '<p>Noch kein Preis eingetragen.</p>'}${safeUrl(b.website) ? `<p><a href="${safeUrl(b.website)}" target="_blank" rel="noopener noreferrer">Website</a></p>` : ''}`;
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
function chooseDrink(drink: Drink) { budgets[f.drink!] = f.max; f.max = budgets[drink]; $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : ''; f.drink = drink; f.mode = 'glass'; selected = undefined; rebuild(); }
$('drink-beer').onclick = () => chooseDrink('beer'); $('drink-coffee').onclick = () => chooseDrink('coffee'); $('drink-pizza').onclick = () => chooseDrink('pizza');
$('view-map').onclick = () => showView(false); $('view-list').onclick = () => showView(true);
$('toolbar-toggle').onclick = () => {
  const collapsed = $('app').classList.toggle('toolbar-collapsed');
  $('toolbar-toggle').setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'Suche und Filter ausklappen' : 'Suche und Filter einklappen';
  $('toolbar-toggle').setAttribute('aria-label', label); $('toolbar-toggle').title = label;
  if (collapsed) {
    closeSearchSuggestions();
    $('filters').hidden = true; $('filters-toggle').setAttribute('aria-expanded', 'false');
  }
};
$('search').oninput = event => {
  clearTimeout(searchZoomTimer);
  f.query = $<HTMLInputElement>('search').value;
  selected = undefined; activeSuggestion = -1; searchOpen = true;
  render();
  if (!(event as InputEvent).isComposing && f.query.trim().length >= 2) searchZoomTimer = setTimeout(zoomToSearchResults, 350);
};
$('search').onfocus = () => { searchOpen = true; renderSearchSuggestions(); };
$('search-clear').onpointerdown = event => event.preventDefault();
$('search-clear').onclick = () => {
  clearTimeout(searchZoomTimer);
  closeSearchSuggestions();
  f.query = ''; selected = undefined;
  render();
  $('search').focus({ preventScroll: true });
};
$('search').onblur = closeSearchSuggestions;
$('search').onkeydown = event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { clearTimeout(searchZoomTimer); closeSearchSuggestions(); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); searchOpen = true;
    renderSearchSuggestions();
    if (!suggestions.length) return;
    activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : activeSuggestion < 0 ? 0 : -1) + suggestions.length) % suggestions.length;
    renderSearchSuggestions();
    $(`search-option-${activeSuggestion}`).scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault(); clearTimeout(searchZoomTimer);
    if (searchOpen && suggestions.length) selectSearchSuggestion(activeSuggestion >= 0 ? activeSuggestion : 0);
    else { closeSearchSuggestions(); zoomToSearchResults(); }
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
$('sort').onchange = () => { f.sort = $<HTMLSelectElement>('sort').value; if (f.sort === 'distance' && !position) locate(); else render(); };
for (const [id, key] of [['unknown', 'unknown'], ['outdoor', 'outdoor'], ['alcohol-free', 'alcoholFree']] as const) $(id).onchange = () => { if (key === 'unknown') cheapMode = false; f[key] = $<HTMLInputElement>(id).checked; render(); };
$('normalize').onchange = () => { f.mode = $<HTMLInputElement>('normalize').checked ? 'half' : 'glass'; render(); };
$('filters-toggle').onclick = () => { $('filters').hidden = !$('filters').hidden; $('filters-toggle').setAttribute('aria-expanded', String(!$('filters').hidden)); };
$('reset').onclick = () => {
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
  if (!navigator.geolocation) return toast('Standort wird von diesem Browser nicht unterstützt.');
  if (locating) return;
  locating = true;
  const button = $<HTMLButtonElement>('locate');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const finish = () => { locating = false; button.disabled = false; button.removeAttribute('aria-busy'); };
  navigator.geolocation.getCurrentPosition(p => {
    finish();
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
  }, () => { finish(); if (f.sort === 'distance') { f.sort = 'price'; $<HTMLSelectElement>('sort').value = 'price'; } toast('Standort nicht verfügbar.'); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
}
$('locate').onclick = () => locate(true);
$('cheap').onclick = () => {
  cheapMode = !cheapMode;
  selected = undefined;
  render();
};
$('data-info').onclick = () => {
  $('coverage').textContent = Object.entries(datasets).map(([drink, data]) => `${drink === 'pizza' ? 'Pizza Margherita' : drink === 'beer' ? 'Bier' : 'Kaffee'}: ${data.bars.reduce((n, b) => n + b.offers.length, 0)} Angebote aus Karten bei ${data.bars.filter(b => b.offers.length).length} Lokalen`).join('. ') + `. ${entries.length} gemeinsame Einträge/Korrekturen.`;
  $<HTMLDialogElement>('info').showModal();
};
for (const format of ['csv', 'json'] as const) {
  $('download-' + format).onclick = () => {
    downloadExport(createExport(cityId, datasets, entries, communityReady), format);
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
  name.placeholder = category === 'coffee' ? 'z. B. Espresso' : 'z. B. Lager';
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
  if (!communityReady) return toast('Gemeinsame Preise sind gerade nicht verfügbar. Bitte neu laden.');
  map.closePopup();
  editing = offer;
  $<HTMLFormElement>('price-form').reset();
  $('form-title').textContent = offer ? 'Preis ändern' : 'Preise hinzufügen';
  $('menu-scan').hidden = Boolean(offer);
  $<HTMLDetailsElement>('manual-entry').open = Boolean(offer);
  $('scan-status').hidden = true;
  $<HTMLInputElement>('entry-bar').value = bar.id;
  $('entry-location').textContent = 'Die Preise werden diesem Lokal zugeordnet.';
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
  saving = true;
  $<HTMLButtonElement>('scan-menu').disabled = true;
  $<HTMLButtonElement>('cancel-price').disabled = true;
  $<HTMLFieldSetElement>('manual-fields').disabled = true;
  $('menu-scan').setAttribute('aria-busy', 'true');
  $('form-error').hidden = true;
  $('scan-status').hidden = false; $('scan-status').textContent = 'Foto wird vorbereitet …';
  try {
    const image = await prepareMenuPhoto(file);
    $('scan-status').textContent = 'Karte wird gelesen und Preise werden gespeichert …';
    const response = await fetch(`/api/scan-menu?city=${cityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barId, image }), signal: AbortSignal.timeout(100000) });
    const result = await response.json().catch(() => { throw new Error('Der Scan ist gerade nicht verfügbar. Bitte später erneut versuchen.'); });
    if (!response.ok) throw new Error(result.error || 'Das Foto konnte nicht verarbeitet werden.');
    const scanned = result as MenuScanResult;
    const ids = new Set(scanned.entries.map(entry => entry.id));
    entries = [...entries.filter(entry => !ids.has(entry.id)), ...scanned.entries];
    if (scanned.entries.length && !scanned.entries.some(entry => entry.drink === f.drink)) f.drink = scanned.entries[0].drink;
    cheapMode = false; selected = barId;
    $<HTMLDialogElement>('price-dialog').close(); rebuild();
    const bar = bars.find(b => b.id === barId) || locationCatalogue.find(b => b.id === barId);
    if (bar) showBar(bar);
    toast(scanSummary(scanned));
  } catch (error) {
    $('scan-status').hidden = true;
    $('form-error').textContent = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
      ? error.message : 'Verbindung unterbrochen. Bitte lade die Seite neu, um bereits gespeicherte Preise zu sehen.';
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
  try {
    const drink = $<HTMLSelectElement>('entry-drink').value as Drink;
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
    saving = true; $<HTMLButtonElement>('scan-menu').disabled = true; $<HTMLButtonElement>('save-price').disabled = true; $<HTMLButtonElement>('cancel-price').disabled = true; $('save-price').textContent = 'Speichern …';
    const response = await fetch(pricesApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
    const result = await response.json().catch(() => { throw new Error('Speichern gerade nicht möglich. Bitte erneut versuchen.'); });
    if (!response.ok) {
      if (response.status === 409 && await loadCommunity()) rebuild();
      throw new Error(result.error || 'Speichern fehlgeschlagen.');
    }
    const entry = result.entry as PriceEntry;
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
    toast('Gespeichert. Für alle sichtbar.');
  } catch (error) {
    $('form-error').textContent = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name) ? error.message : 'Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.';
    $('form-error').hidden = false;
  } finally { saving = false; $<HTMLButtonElement>('scan-menu').disabled = false; $<HTMLButtonElement>('save-price').disabled = false; $<HTMLButtonElement>('cancel-price').disabled = false; $('save-price').textContent = 'Speichern'; }
};
async function loadCommunity() {
  try {
    const response = await fetch(pricesApi, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!Array.isArray(result.entries)) throw new Error();
    entries = result.entries; communityReady = true;
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
  const missing = [!beerResult ? 'Bier' : '', !coffeeResult ? 'Kaffee' : '', !pizzaResult ? 'Pizza' : '', !loadedCommunity ? 'gemeinsame Einträge' : ''].filter(Boolean);
  const hasData = Object.keys(datasets).length > 0;
  for (const format of ['csv', 'json']) $<HTMLButtonElement>('download-' + format).disabled = !hasData;
  $('download-status').textContent = !hasData ? 'Download nicht verfügbar. Bitte lade die Seite erneut.' : missing.length ? `Unvollständiger Export: ${missing.join(', ')} konnten nicht geladen werden. Bitte lade die Seite erneut für einen vollständigen Export.` : 'Gemeinsame Einträge und Korrekturen sind enthalten.';
  $<HTMLInputElement>('price').value = String(f.max);
  const errors = [!beerResult ? 'Bierdaten konnten nicht geladen werden.' : '', !coffeeResult ? 'Kaffeedaten konnten nicht geladen werden.' : '', !pizzaResult ? 'Pizzadaten konnten nicht geladen werden.' : '', !locationsResult ? 'Zusätzliche Kartenlokale konnten nicht geladen werden. Bitte neu laden.' : ''].filter(Boolean);
  if (errors.length) { $('load-error').textContent = errors.join(' '); $('load-error').hidden = false; }
  rebuild();
  const linkedId = initial.get('bar');
  if (linkedId) {
    const linkedBar = bars.find(b => b.id === linkedId);
    if (linkedBar) showBar(linkedBar);
    else toast('Das geteilte Lokal ist gerade nicht verfügbar.');
  } else if (f.query.trim()) zoomToSearchResults();
}
syncControls();
void init();
if (districtState.enabled) {
  $('filters').hidden = false; $('filters-toggle').setAttribute('aria-expanded', 'true');
  void loadDistricts();
}
