import { legalPaths } from './legal-links';
import { contributionFetch } from './contribution-security';
import { cities, cityFromPath, cityLink, defaultCityLocale, type City } from './cities';
import L from 'leaflet';
import { inject } from '@vercel/analytics';
import { analyticsBeforeSend, trackEvent } from './analytics';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { loadCoffeeRatings, showCoffeeRating } from './coffee-rating';
import { cityAverage, coverageLabel, missingPriceLabel } from './coverage';
import { selectBeerSize, cheapPriceLimit, bestOffer, matchingOffers, isCurrentOffer, isComparableOffer, offerCategory, coffeeLabels as defaultCoffeeLabels, portion, effectiveBeerType, beerTypeLabel, beerTypeLabels, cost, escapeHtml as e, filterBars, isVenueEligible, matchesVenueType, safeUrl, type Bar, type Dataset, type Filters, type BeerType, type Offer, type OutdoorPermit } from './data';
import { communityVenues, applyEntries, offerKey, validateInput, zurichToday, type Drink, type PriceEntry, type PriceInput } from './community';
import { barLink, shareLink } from './sharing';
import { cheapModeFromSearch, cheapPreferenceKey, dropDefaultCheap, filtersFromSearch, writeFilters } from './filters';
import { createExport, downloadExport } from './export';
import { googleMapsLink, withKnownAddress, locationAtPosition, nearbyLocations, selectableLocations } from './locations';
import { createDistrictLookup, districtFromSearch, type Districts } from './districts';
import { searchSuggestions } from './search';
import { createSearchHistory } from './search-history';
import { searchAddresses, type AddressResult } from './address-search';
import { prepareMenuPhoto, scanSummary, type MenuScanResult } from './menu-scan';
import { dateLocale, locale, localizedPath, t, type Locale } from './i18n';
import { venueForm } from './venue-form';
import { venueCorrectionForm } from './venue-correction-form';
import { applyVenueCorrections, type VenueCorrection } from './venue-corrections';
import { categoryNavigation } from './category-navigation';
import { customMaps } from './custom-maps';
import { pizzaMenuContent } from './pizza-menu';
import { pizzaVarieties, beerVarieties, hasBeerSelection } from './data';
import { beerGroupLabels, parseBeerSelection } from './beer-selection';
import { parsePizzaSelection, pizzaGroupLabels, type PizzaGroup } from './pizza-selection';
import { showGoogleRating, clearGoogleRating } from './google-rating';
import { setupTip } from './tip';

inject({ mode: import.meta.env.DEV ? 'development' : 'production', beforeSend: analyticsBeforeSend });

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => n.toFixed(2);
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => `<option value="${value}">${e(label)}</option>`).join('');
const translated = (labels: Record<string, string>) => Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, t(label)]));
const venueTypes = { '': t('Alle (ohne Imbiss)'), all: t('Alle (inkl. Imbiss)'), bar: 'Bar / Pub', restaurant: 'Restaurant', cafe: 'Café', fast_food: t('Imbiss') };
const cityId = cityFromPath(location.pathname, import.meta.env.BASE_URL);
const coffeeLabels = cityId === 'bern' ? { ...defaultCoffeeLabels, milk: 'Milchkaffee / Schale' } : defaultCoffeeLabels;
const coffeeOptions = options(translated(coffeeLabels));
const city = cities[cityId];
const cityName = t(city.name);
const dataPath = `${import.meta.env.BASE_URL}data/${city.data}`;
// Each city filters by its own official boundaries and their open-data source.
type DistrictTexts = Record<'show' | 'unit' | 'select' | 'all' | 'loading' | 'failed' | 'info' | 'source' | 'sourceName' | 'sourceUrl', string>;
const districtTextsByCity: Partial<Record<City, DistrictTexts>> = {
  zurich: {
    show: t('Kreise anzeigen'), unit: t('Kreis'), select: t('Zürcher Stadtkreis'), all: t('Alle Kreise'), loading: t('Kreise laden …'),
    failed: t('Kreisgrenzen konnten nicht geladen werden. Bitte «Kreise anzeigen» erneut aktivieren.'),
    info: t('Kreise: Unter «Filter» lassen sich die Stadtkreise einblenden und per Karte oder Auswahlfeld auswählen. Der Kreisdurchschnitt wird wie der Stadtdurchschnitt berechnet, jedoch nur mit Lokalen innerhalb der gewählten Kreisgrenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis.'),
    source: t('Kreisgrenzen:'), sourceName: t('Stadt Zürich, Stadtkreise (CC0)'), sourceUrl: 'https://data.stadt-zuerich.ch/dataset/geo_stadtkreise',
  },
  bern: {
    show: t('Stadtteile anzeigen'), unit: t('Stadtteil'), select: t('Berner Stadtteil'), all: t('Alle Stadtteile'), loading: t('Stadtteile laden …'),
    failed: t('Stadtteilgrenzen konnten nicht geladen werden. Bitte «Stadtteile anzeigen» erneut aktivieren.'),
    info: t('Stadtteile: Unter «Filter» lassen sich die sechs Stadtteile einblenden und per Karte oder Auswahlfeld auswählen. Der Durchschnitt eines Stadtteils wird wie der Stadtdurchschnitt berechnet, jedoch nur mit Lokalen innerhalb seiner Grenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis.'),
    source: t('Stadtteilgrenzen:'), sourceName: t('Stadt Bern, Stadtteile (freie Nutzung)'), sourceUrl: 'https://opendata.swiss/de/dataset/stadtteile',
  },
  basel: {
    show: t('Wohnviertel anzeigen'), unit: t('Wohnviertel'), select: t('Basler Wohnviertel'), all: t('Alle Wohnviertel'), loading: t('Wohnviertel laden …'),
    failed: t('Wohnviertelgrenzen konnten nicht geladen werden. Bitte «Wohnviertel anzeigen» erneut aktivieren.'),
    info: t('Wohnviertel: Unter «Filter» lassen sich die 19 Wohnviertel der Stadt Basel einblenden und per Karte oder Auswahlfeld auswählen. Der Durchschnitt eines Wohnviertels wird wie der Stadtdurchschnitt berechnet, jedoch nur mit Lokalen innerhalb seiner Grenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis.'),
    source: t('Wohnviertelgrenzen:'), sourceName: t('Kanton Basel-Stadt, Statistische Raumeinheiten: Wohnviertel (CC BY 4.0)'), sourceUrl: 'https://data.bs.ch/explore/dataset/100042/',
  },
  lausanne: {
    show: t('Quartiere anzeigen'), unit: t('Quartier'), select: t('Lausanner Quartier'), all: t('Alle Quartiere'), loading: t('Quartiere laden …'),
    failed: t('Quartiergrenzen konnten nicht geladen werden. Bitte «Quartiere anzeigen» erneut aktivieren.'),
    info: t('Quartiere: Unter «Filter» lassen sich die 18 statistischen Quartiere von Lausanne einblenden und per Karte oder Auswahlfeld auswählen. Der Quartierdurchschnitt berücksichtigt nur Lokale innerhalb seiner Grenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis.'),
    source: t('Quartiergrenzen:'), sourceName: t('Stadt Lausanne, Quartiers statistiques'), sourceUrl: 'https://viageo.ch/md/29cfd252-6b51-4798-92af-6f9aaf229dcc',
  },
  geneva: {
    show: t('Quartiere anzeigen'), unit: t('Quartier'), select: t('Genfer Quartier'), all: t('Alle Quartiere'), loading: t('Quartiere laden …'),
    failed: t('Quartiergrenzen konnten nicht geladen werden. Bitte «Quartiere anzeigen» erneut aktivieren.'),
    info: t('Quartiere: Unter «Filter» lassen sich die acht Quartiere der Stadt Genf einblenden und per Karte oder Auswahlfeld auswählen. Der Quartierdurchschnitt berücksichtigt nur Lokale innerhalb seiner Grenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis.'),
    source: t('Quartiergrenzen:'), sourceName: t('Stadt Genf / SITG, Quartiers de la ville de Genève'), sourceUrl: 'https://sitg.ge.ch/donnees/vdg-quartier-ville',
  },
  winterthur: {
    show: t('Stadtkreise anzeigen'), unit: t('Stadtkreis'), select: t('Winterthurer Stadtkreis'), all: t('Alle Stadtkreise'), loading: t('Stadtkreise laden …'),
    failed: t('Stadtkreisgrenzen konnten nicht geladen werden. Bitte «Stadtkreise anzeigen» erneut aktivieren.'),
    info: t('Stadtkreise: Unter «Filter» lassen sich die sieben Stadtkreise von Winterthur einblenden und per Karte oder Auswahlfeld auswählen. Der Durchschnitt eines Stadtkreises wird wie der Stadtdurchschnitt berechnet, jedoch nur mit Lokalen innerhalb seiner Grenze. Die Zahl in Klammern nennt die Lokale mit passendem Preis.'),
    source: t('Stadtkreisgrenzen:'), sourceName: t('Kanton Zürich, Stadtkreise und Quartiere Zürich und Winterthur (freie Nutzung)'), sourceUrl: 'https://opendata.swiss/de/dataset/stadtkreise-und-quartiere-zurich-und-winterthur',
  },
};
// Olten has no district boundaries: its filter stays hidden, so these empty texts are never shown.
const noDistrictTexts: DistrictTexts = { show: '', unit: '', select: '', all: '', loading: '', failed: '', info: '', source: '', sourceName: '', sourceUrl: '' };
const districtTexts = districtTextsByCity[cityId] ?? noDistrictTexts;
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
let communityReady = false, saving = false, pizzaAvailable = false, ramenAvailable = false;
let cheapPreference: string | null = null;
try { cheapPreference = localStorage.getItem(cheapPreferenceKey); } catch { /* Storage can be blocked. */ }
let cheapMode = cheapModeFromSearch(initial, cheapPreference);
function rememberCheapMode(enabled: boolean) {
  cheapMode = enabled;
  try { localStorage.setItem(cheapPreferenceKey, enabled ? '1' : '0'); } catch { /* Keep the choice for this page. */ }
}
let cheapLimit: number | undefined;
let pizzaOptions: ReturnType<typeof pizzaVarieties> = [];
let beerOptions: ReturnType<typeof beerVarieties> = [];
let locationCatalogue: Bar[] = [];
let customMapUI: ReturnType<typeof customMaps> | undefined;
let addedVenues: Bar[] = [];
let venueCorrections: VenueCorrection[] = [];
let userMarker: L.CircleMarker | undefined;
let suggestions: (Bar | AddressResult)[] = [], activeSuggestion = -1, searchOpen = false;
let addressResults: AddressResult[] = [], addressSelection: AddressResult | undefined;
let addressController: AbortController | undefined, addressTimer: ReturnType<typeof setTimeout> | undefined;
let addressStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let addressRequest = 0;
let addressPromise: Promise<void> | undefined;
const searchHistory = createSearchHistory(cityId);
const coffee = () => f.drink === 'coffee';
const pizza = () => f.drink === 'pizza';
const beer = () => f.drink === 'beer';
const ramen = () => f.drink === 'ramen';
// Ramen appears only once enough venues have a current price, like pizza.
const RAMEN_MIN_VENUES = 5;
const budgets: Record<Drink, number> = { beer: Infinity, coffee: Infinity, pizza: Infinity, ramen: Infinity };
const unit = (o: Offer) => offerCategory(o) !== 'beer' ? portion(o) : `${f.mode === 'half' ? `5 dl${o.volumeMl === 500 ? '' : ` · ${t('umgerechnet')}`}` : portion(o)} · ${beerTypeLabel(o)}`;

$('app').innerHTML = `
<div class="toolbar">
  <div id="category-navigation" class="toolbar-heading"></div>
  <div class="search-box">
    <input id="search" type="search" role="combobox" placeholder="${t('Lokal, Adresse, PLZ oder Ort')}" aria-label="${t('Lokal oder Adresse suchen')}" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="search-suggestions">
    <button id="search-clear" type="button" aria-label="${t('Suche löschen')}" title="${t('Suche löschen')}" hidden><span aria-hidden="true">×</span></button>
    <div id="search-dropdown" hidden><div id="search-history-heading" hidden><strong>${t('Letzte Suchen')}</strong><button id="search-history-clear" type="button">${t('Verlauf löschen')}</button></div><div id="search-suggestions" role="listbox" aria-label="${t('Suchvorschläge')}"></div><p id="search-empty" role="status" hidden></p></div>
  </div>
  <div id="beer-controls" class="beer-controls">
    <select id="beer-type" aria-label="${t('Ausschank')}">${options({ draft: t('Offenbier'), bottle: t('Flaschenbier'), all: t('Alle Ausschankarten'), can: t('Dosenbier'), unknown: t('Unbekannt') })}</select>
    <select id="volume" aria-label="${t('Biergrösse')}">${options({ stange: 'Stange / 3 dl', '300-330': '3 / 3.3 dl', '500': '5 dl', '330': '3.3 dl', '400': '4 dl', all: t('Alle Grössen') })}</select>
  </div>
  <select id="coffeeType" aria-label="${t('Kaffeesorte oder Matcha Latte')}" hidden><option value="all">${e(t('Alle Kaffees & Matcha Latte'))}</option>${coffeeOptions}</select>
  <div id="pizza-controls" class="pizza-controls" hidden>
    <select id="pizza-selection" aria-label="${t('Pizzasorte')}" title="${t('Klassiker nach Zutaten gruppiert')}"><option value="margherita">Margherita</option><option value="all">${t('Alle Pizzen')}</option></select>
    <input id="pizza-query" type="search" maxlength="120" placeholder="${t('z. B. Prosciutto oder Pilze')}" aria-label="${t('Pizzaname oder Zutat')}">
  </div>
  <label class="budget">${t('Bis CHF')} <input id="price" aria-label="${t('Höchstpreis in CHF')}" type="number" min="0.5" step="0.01"></label>
  <button id="filters-toggle" aria-expanded="false" aria-controls="filters">${t('Filter')} <span class="filter-chevron" aria-hidden="true"></span></button>
</div>
<div id="filters" hidden>
  <div id="beer-selection-controls" class="beer-selection-controls" hidden>
    <label>${t('Bier')} <select id="beer-selection" aria-label="${t('Bier auswählen')}"><option value="all">${t('Alle Biere')}</option></select></label>
    <input id="beer-query" type="search" maxlength="120" placeholder="${t('z. B. Quöllfrisch')}" aria-label="${t('Biername oder Marke')}">
  </div>
  <label>${t('Lokal')} <select id="type">${options(venueTypes)}</select></label>
  <label><input id="unknown" type="checkbox" checked> ${t('Ohne passenden Preis anzeigen')}</label>
  <label><input id="outdoor" type="checkbox"> ${t('Draussen sitzen')}</label>
  <label id="alcohol-label"><input id="alcohol-free" type="checkbox"> ${t('Alkoholfrei')}</label>
  <label id="normalize-label"><input id="normalize" type="checkbox"> ${t('Auf 5 dl umrechnen')}</label>
  <label${city.districts ? '' : ' hidden'}><input id="district-toggle" type="checkbox" aria-controls="district-select-label"> ${districtTexts.show}</label><label id="district-select-label" hidden>${districtTexts.unit} <select id="district-select" aria-label="${districtTexts.select}"><option value="">${districtTexts.all}</option></select></label>
  <button id="reset">${t('Zurücksetzen')}</button>
</div>
<div class="status-row"><div class="status-summary" role="status"><strong id="city-average">${e(t('Schnitt {city} {value}', { city: cityName, value: '—' }))}</strong><strong id="district-average" hidden></strong><span id="count">${t('Laden …')}</span></div><div class="mobile-switch" role="group" aria-label="${t('Ansicht')}"><button id="view-map" aria-pressed="true">${t('Karte')}</button><button id="view-list" aria-pressed="false">${t('Liste')}</button></div><div class="status-meta"><small class="refresh-note">${t('Wird alle 3 Wochen aktualisiert')}</small><nav class="city-switch" aria-label="${t('Stadt wechseln')}">${(['zurich', 'bern', 'basel'] as City[]).map(id => `<a data-city="${id}" href="${e(cityLink(id, location.search, import.meta.env.BASE_URL, locale()))}"${id === cityId ? ' aria-current="page"' : ''}>${t(cities[id].name)}</a>`).join('<span aria-hidden="true">/</span>')}<details class="city-more" id="city-more"><summary aria-label="${t('Weitere Städte')}" title="${t('Weitere Städte')}"><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="city-more-menu">${(['winterthur', 'olten', 'lausanne', 'geneva'] as City[]).map(id => `<a data-city="${id}" href="${e(cityLink(id, location.search, import.meta.env.BASE_URL, defaultCityLocale(id, locale())))}"${id === cityId ? ' aria-current="page"' : ''}>${t(cities[id].name)}</a>`).join('')}<a class="city-request" href="mailto:hello@wobillig.ch?subject=${encodeURIComponent(t('Neue Stadt für wobillig'))}&amp;body=${encodeURIComponent(t('Diese Stadt wünsche ich mir auf wobillig:') + '\r\n\r\n')}" aria-label="${t('Stadt wünschen')}" title="${t('Stadt wünschen')}"><span aria-hidden="true">+</span></a></div></details></nav><button id="data-info" class="text-button">${t('Daten')}</button></div></div>
<div id="load-error" role="status" hidden></div>
<main>
  <aside class="list-panel" aria-label="${t('Lokale')}"><div class="list-tools"><a id="rankings-link" class="rankings-link" href="#kaffeepreise" aria-label="${t('Ranglisten und Quellen')}" title="${t('Ranglisten und Quellen')}">${t('Ranglisten')}</a><select id="sort" aria-label="${t('Sortierung')}">${options({ price: t('Preis aufsteigend'), price_desc: t('Preis absteigend'), name: 'Name A–Z', distance: t('Entfernung') })}</select></div><div id="results"></div></aside>
  <section class="map-panel" aria-label="${t('Karte')}"><div id="map"></div><div class="map-actions"><button id="locate" aria-pressed="false" aria-label="${t('Standort anzeigen')}" title="${t('Standort anzeigen')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg></button><button id="cheap" aria-pressed="false" disabled>${t('Günstig')}</button></div><section id="detail" aria-label="${t('Lokal und Preise')}" tabindex="-1" hidden></section>
<footer class="app-footer"><button id="tip-coffee" type="button" hidden></button><a href="mailto:hello@wobillig.ch">${t('Kontakt')}</a></footer>
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
  <div class="form-row"><label>${t('Kategorie')}<select id="entry-drink"><option value="coffee">${t('Kaffee')}</option><option value="beer">${t('Bier')}</option><option value="ramen">${t('Ramen')}</option><option value="pizza">Pizza Margherita</option></select></label><label id="entry-coffee-label" hidden>${t('Sorte')}<select id="entry-coffee">${coffeeOptions}</select></label></div>
  <label>${t('Bezeichnung')}<input id="entry-name" maxlength="100" placeholder="${t('z. B. Lager oder Espresso')}" required></label>
  <div id="entry-beer-fields"><label>${t('Ausschank')}<select id="entry-beer-type">${options(translated(beerTypeLabels))}</select></label><small id="entry-type-hint" class="muted" hidden>${t('Diese Vorauswahl ist geschätzt. Bitte prüfen.')}</small><div class="form-row"><label>${t('Menge in dl')}<input id="entry-volume" type="number" min="1" max="10" step="0.01" value="5"></label><label class="inline-check"><input id="entry-stange" type="checkbox"> Stange</label></div><label class="check"><input id="entry-size-unknown" type="checkbox"> ${t('Menge nicht angegeben (nur Stange)')}</label><label class="check"><input id="entry-alcohol" type="checkbox"> ${t('Alkoholfrei')}</label></div>
  <div class="form-row"><label>${t('Preis in CHF')}<input id="entry-price" type="number" min="0.5" max="50" step="0.01" inputmode="decimal" required></label><label>${t('Preis gesehen am')}<input id="entry-date" type="date" min="2020-01-01" required></label></div>
  <label>${t('Link zur Karte (optional)')}<input id="entry-source" type="url" maxlength="1500" placeholder="https://…"></label>
  <p class="muted">${t('Kleine Korrekturen kannst du direkt speichern. Bei grösseren Änderungen laden wir dich ein, eine aktuelle Menükarte hochzuladen.')}</p>
  <p class="muted">${t('Wird für alle sichtbar. Bitte den tatsächlichen Preis dieser Portion eintragen.')}</p>
  <button id="save-price" class="primary" type="submit">${t('Speichern')}</button>
  </fieldset></details>
  <p id="form-error" role="alert" hidden></p>
</form></dialog>
<dialog id="info" aria-label="${t('Daten')}"><div class="dialog-top"><strong>${t('Daten')}</strong><button id="close-info">${t('Schliessen')}</button></div><section class="data-download" aria-labelledby="download-title"><strong id="download-title">${e(t('Daten für {city} herunterladen', { city: cityName }))}</strong><p>${t('Alle erfassten Angebote für Bier, Kaffee und Pizza, unabhängig von deinen Filtern. Mit Originalpreisen in CHF, Mengen, Quellen, Datum und Prüfstatus sowie verfügbaren gemeinsamen Korrekturen.')}</p><div class="download-actions"><button id="download-csv" class="primary" disabled>${t('CSV herunterladen')}</button><button id="download-json" disabled>${t('JSON herunterladen')}</button></div><p class="muted">${t('CSV: eine Zeile pro Angebot, UTF-8, Semikolon als Trennzeichen. JSON enthält zusätzlich Lokale ohne Preis und die vollständigen Angebotsdetails. Abgelaufene Angebote sind im CSV gekennzeichnet; im JSON bleibt das Fotodatum erhalten.')}</p><p id="download-status" class="muted" role="status">${t('Daten werden geladen …')}</p></section><p id="coverage"></p><p>${t('Der Stadtdurchschnitt verwendet den günstigsten passenden Preis je Lokal für die gewählte Sorte, Biergrösse und Ausschankart. Alkoholfrei und die optionale Umrechnung auf 5 dl werden berücksichtigt. Suche, Preislimit, «Günstig» und «Draussen sitzen» verändern diesen stadtweiten Vergleichswert nicht. Der Lokaltyp zählt mit: Ohne Auswahl bleiben Imbisse ausgeschlossen. Lokale ohne passenden Preis zählen nicht mit. Bei «Alle» wird das jeweils günstigste passende Angebot verwendet.')}</p><p>${districtTexts.info} ${districtTexts.source} <a href="${districtTexts.sourceUrl}" target="_blank" rel="noopener noreferrer">${districtTexts.sourceName}</a>.</p>${cityId === 'basel' ? `<p>${t('Draussen sitzen: In Basel zählen neben den Angaben aus OpenStreetMap auch Lokale mit einer gültigen Boulevard-Bewilligung des Kantons. Zugeordnet sind nur Bewilligungen, deren Name und Standort eindeutig zu einem Lokal passen. Saisonbewilligungen zählen nur während der bewilligten Zeit.')} ${t('Bewilligungen:')} <a href="https://data.bs.ch/explore/dataset/100018/" target="_blank" rel="noopener noreferrer">${t('Kanton Basel-Stadt, Allmendbewilligungen (CC BY 4.0)')}</a>.</p>` : ''}<p>${t('Preise stammen aus verlinkten Speise- und Getränkekarten oder wurden von Besuchern eingetragen. Eingetragene Preise und Foto-Uploads behalten Vorrang, ausser eine belegbar neuere Website-Karte nennt einen abweichenden Preis. Quelle, Menge und Datum stehen beim Angebot.')}</p><p>${t('Pizza: Preis pro ganzer, normaler Margherita im Lokal. Grössen können je nach Restaurant abweichen. Kinderpizzen, Spezialvarianten und reine Liefer- oder Take-away-Preise sind ausgeschlossen.')}</p><p>${t('Bier: Cafés erscheinen mit einem erfassten, aktuellen Bierangebot unabhängig von ihren Öffnungszeiten. Cafés ohne Bierangebot werden auch bei «Ohne passenden Preis anzeigen» ausgeblendet.')}</p><p>${t('Stange: 3 dl oder ausdrücklich als Stange bezeichnete kleine Portion; bekannte Flaschen und Dosen sind ausgeschlossen. Fehlt die Ausschankart in der Quelle, wird sie anhand von Menü, Bezeichnung und Menge geschätzt. Solche Angaben sind als «geschätzt» gekennzeichnet und zählen im Ausschank-Filter mit. Fehlende Mengen bleiben offen. Die optionale Umrechnung auf 5 dl ist ein Vergleichspreis.')}</p><p><a href="${import.meta.env.BASE_URL.replace(/\/$/, '')}${legalPaths(locale()).privacy}">${t('Wie wobillig deine Daten verarbeitet')}</a><br>${t('Standorte und Karte:')} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">${t('© OpenStreetMap-Mitwirkende, ODbL')}</a>.</p></dialog>`;

const categoryNav = categoryNavigation($('category-navigation'), chooseDrink, dataPath);
const cityMenu = $<HTMLDetailsElement>('city-more');
document.addEventListener('click', event => {
  if (!cityMenu.contains(event.target as Node)) cityMenu.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && cityMenu.open) {
    cityMenu.open = false;
    cityMenu.querySelector('summary')?.focus();
  }
});
const map = L.map('map', { zoomControl: false }).setView(city.center, 14);
const openVenueForm = venueForm(cityId, pricesApi, () => selectableLocations(venues, locationCatalogue), (bar, created) => {
  if (!addedVenues.some(b => b.id === bar.id)) addedVenues.push(bar);
  clearAddressSelection(); f.query = ''; f.type = 'all'; f.unknown = true; f.outdoor = false;
  districtState.selected = undefined; cheapMode = false; f.drink = 'coffee'; selected = bar.id;
  closeSearchSuggestions(); rebuild(); showBar(bar, 18);
  toast(created ? t('Lokal gespeichert und für alle sichtbar. Du kannst jetzt Preise hinzufügen.') : t('Dieses Lokal ist bereits vorhanden. Du kannst hier Preise hinzufügen oder die Angaben über «Lokal korrigieren» ändern.'));
});
const openVenueCorrection = venueCorrectionForm(pricesApi, correction => {
  venueCorrections = [...venueCorrections.filter(item => item.barId !== correction.barId), correction];
  rebuild();
  const bar = bars.find(item => item.id === correction.barId) || venues.find(item => item.id === correction.barId);
  if (bar) showBar(bar, map.getZoom());
  toast(t('Korrektur gespeichert. Für alle sichtbar.'));
});
const addVenueButton = document.createElement('button');
addVenueButton.id = 'add-venue'; addVenueButton.className = 'text-button'; addVenueButton.textContent = t('Lokal hinzufügen');
$('data-info').before(addVenueButton);
addVenueButton.onclick = () => {
  if (!communityReady) return toast(t('Gemeinsame Einträge sind gerade nicht verfügbar. Bitte neu laden.'));
  openVenueForm(map.getCenter(), addressSelection ? '' : f.query.trim());
};
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
const zoomControl = L.control.zoom({ position: 'bottomright' }).addTo(map);
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
    const response = await fetch(`${dataPath}districts.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Grenzen fehlen');
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
    toast(districtTexts.failed);
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
function districtName(number: number) {
  return districtData?.features.find(d => d.properties.number === number)?.properties.name ?? t('Kreis {number}', { number });
}
function renderDistricts() {
  const enabled = districtState.enabled;
  $<HTMLInputElement>('district-toggle').checked = enabled;
  $('district-select-label').hidden = !enabled;
  const select = $<HTMLSelectElement>('district-select');
  select.disabled = !districtData;
  $('district-average').hidden = true;
  if (!enabled || !districtData) {
    districtLayer.remove();
    select.innerHTML = `<option value="">${districtsLoading ? districtTexts.loading : districtTexts.all}</option>`;
    return;
  }
  if (!map.hasLayer(districtLayer)) districtLayer.addTo(map);
  const averages = new Map(districtData.features.map(d => {
    const number = d.properties.number;
    return [number, cityAverage(bars.filter(b => districtLookup!(b) === number), f)];
  }));
  const label = (number: number) => {
    const average = averages.get(number);
    return `${e(districtName(number))} · ${average ? `Ø CHF ${money(average.price)} (${average.count})` : t('kein passender Preis')}`;
  };
  select.innerHTML = `<option value="">${districtTexts.all}</option>` + districtData.features.map(d => `<option value="${d.properties.number}">${label(d.properties.number)}</option>`).join('');
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
      ? t('Schnitt {district} CHF {price} ({count} Lokale)', { district: districtName(districtState.selected), price: money(average.price), count: average.count })
      : t('Schnitt {district}: keine passenden Preise', { district: districtName(districtState.selected) });
    $('district-average').title = t('Günstigster passender Preis je Lokal innerhalb der gewählten Grenze. Unabhängig von Suche, Preislimit, Günstig-Filter und Draussen-Filter. Der Lokaltyp zählt mit.');
  }
}
$('district-toggle').onchange = () => {
  districtState.enabled = $<HTMLInputElement>('district-toggle').checked;
  if (!districtState.enabled) districtState.selected = undefined;
  selected = undefined;
  render();
  if (districtState.enabled) void loadDistricts();
};
$('district-select').onchange = () => chooseDistrict(Number($<HTMLSelectElement>('district-select').value) || undefined);
function rebuild() {
  const catalogueById = new Map(locationCatalogue.map(bar => [bar.id, bar]));
  const correctedIds = new Set(venueCorrections.map(item => item.barId));
  venues = applyVenueCorrections(selectableLocations(communityVenues(datasets, entries, addedVenues), locationCatalogue.filter(bar => correctedIds.has(bar.id)))
    .map(bar => withKnownAddress(bar, catalogueById.get(bar.id))), venueCorrections);
  const pizzaBars = datasets.pizza ? applyEntries(datasets.pizza, entries, venues, 'pizza', venueCorrections).bars : [];
  pizzaOptions = pizzaVarieties(pizzaBars);
  // Count priced venues city-wide, including contributions, independently of UI filters.
  pizzaAvailable = pizzaBars.filter(b => [...b.offers, ...(b.pizzaMenu || [])]
    .some(o => o.pizzaType && isCurrentOffer(o) && isComparableOffer(o))).length >= 14;
  if (pizza() && !pizzaAvailable) {
    f.drink = 'coffee'; f.max = budgets.coffee; f.mode = 'glass'; selected = undefined;
    $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : '';
  }
  const ramenBars = datasets.ramen ? applyEntries(datasets.ramen, entries, venues, 'ramen', venueCorrections).bars : [];
  ramenAvailable = ramenBars.filter(b => b.offers.some(o => offerCategory(o) === 'ramen' && isCurrentOffer(o) && isComparableOffer(o))).length >= RAMEN_MIN_VENUES;
  if (ramen() && !ramenAvailable) {
    f.drink = 'coffee'; f.max = budgets.coffee; f.mode = 'glass'; selected = undefined;
    $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : '';
  }
  const base = datasets[f.drink!];
  bars = ramen() ? ramenBars : pizza() ? pizzaBars : base ? applyEntries(base, entries, venues, f.drink!, venueCorrections).bars : [];
  if (beer()) beerOptions = beerVarieties(bars);
  render();
}
function syncControls() {
  if (customMapUI?.isOpen) return;
  const heading = beer() ? t('Bierpreise {city}', { city: cityName }) : ramen() ? t('Ramenpreise {city} · Community', { city: cityName }) : pizza() ? t('Pizzapreise {city}', { city: cityName }) : t('Kaffeepreise {city}', { city: cityName });
  if ($('map-title').textContent !== heading) $('map-title').textContent = heading;
  document.title = coffee() ? coffeePageTitle : t('{heading} vergleichen | wobillig', { heading });
  $<HTMLSelectElement>('type').innerHTML = options(venueTypes);
  $<HTMLSelectElement>('type').value = f.type;
  $('beer-controls').hidden = !beer(); $('coffeeType').hidden = !coffee();
  $('beer-selection-controls').hidden = !beer();
  const beerSelect = $<HTMLSelectElement>('beer-selection');
  const beerValue = f.beerQuery?.trim() ? 'all' : f.beerSelection || 'all';
  const availableBeers = [{ value: 'all', label: t('Alle Biere') }, ...beerOptions];
  if (!availableBeers.some(option => option.value === beerValue) && f.beerSelection) {
    availableBeers.push({ value: f.beerSelection, label: beerGroupLabels[f.beerSelection] });
  }
  const beerOptionHtml = availableBeers.map(({ value, label }) => `<option value="${e(value)}">${e(label)}</option>`).join('');
  if (beerSelect.innerHTML !== beerOptionHtml) beerSelect.innerHTML = beerOptionHtml;
  beerSelect.value = beerValue;
  $('pizza-controls').hidden = !pizza();
  const pizzaSelect = $<HTMLSelectElement>('pizza-selection');
  const pizzaValue = f.pizzaQuery?.trim() ? 'all' : f.pizzaSelection || 'margherita';
  const availablePizzas = [{ value: 'margherita', label: 'Margherita' }, ...pizzaOptions, { value: 'all', label: t('Alle Pizzen') }];
  // Retain a shared selection when the destination city has no price for it.
  if (!availablePizzas.some(option => option.value === pizzaValue)) availablePizzas.push({
    value: pizzaValue,
    label: pizzaValue.startsWith('group:') ? pizzaGroupLabels[pizzaValue.slice(6) as PizzaGroup] : pizzaValue.slice(5),
  });
  const pizzaOptionHtml = availablePizzas.map(({ value, label }) => `<option value="${e(value)}">${e(label)}</option>`).join('');
  if (pizzaSelect.innerHTML !== pizzaOptionHtml) pizzaSelect.innerHTML = pizzaOptionHtml;
  pizzaSelect.value = pizzaValue;
  $<HTMLInputElement>('pizza-query').value = f.pizzaQuery || '';
  $<HTMLInputElement>('beer-query').value = f.beerQuery || '';
  $<HTMLSelectElement>('volume').querySelector<HTMLOptionElement>('[value=stange]')!.disabled = ['bottle', 'can'].includes(f.beerType!);
  $<HTMLSelectElement>('beer-type').value = f.beerType || 'all';
  $('alcohol-label').hidden = !beer(); $('normalize-label').hidden = !beer() || ['stange', '300', '300-330'].includes(f.volume);
  $<HTMLSelectElement>('volume').value = f.volume;
  $<HTMLSelectElement>('coffeeType').value = f.coffeeType!;
  $<HTMLInputElement>('normalize').checked = f.mode === 'half';
  categoryNav.update(f.drink!, pizzaAvailable, ramenAvailable);
  $<HTMLInputElement>('search').value = f.query;
  $('search-clear').hidden = f.query.length === 0;
  $<HTMLSelectElement>('sort').value = f.sort;
  $<HTMLInputElement>('outdoor').checked = f.outdoor;
  $<HTMLInputElement>('alcohol-free').checked = f.alcoholFree;
  const url = new URL(location.href);
  writeFilters(url.searchParams, f, cheapMode);
  if (addressSelection) url.searchParams.set('address', '1'); else url.searchParams.delete('address');
  if (city.districts) {
    if (districtState.enabled) url.searchParams.set(city.districts.toggle, '1'); else url.searchParams.delete(city.districts.toggle);
    if (districtState.enabled && districtState.selected) url.searchParams.set(city.districts.param, String(districtState.selected)); else url.searchParams.delete(city.districts.param);
  }
  if (selected) url.searchParams.set('bar', selected); else url.searchParams.delete('bar');
  dropDefaultCheap(url.searchParams);
  history.replaceState(null, '', url);
  document.querySelectorAll<HTMLAnchorElement>('[data-city]').forEach(link => {
    // City links drop the venue, which can leave cheap=1 as the only parameter.
    const target = new URL(cityLink(link.dataset.city as City, url.search, import.meta.env.BASE_URL, defaultCityLocale(link.dataset.city as City, locale(), cityId)), location.origin);
    dropDefaultCheap(target.searchParams);
    link.href = target.pathname + target.search;
  });
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
  $<HTMLAnchorElement>('rankings-link').href = beer() ? '#bierpreise' : pizza() ? '#pizzapreise' : '#kaffeepreise';
  const districtBars = bars.filter(inSelectedDistrict);
  cheapLimit = cheapPriceLimit(districtBars, addressSelection ? { ...f, query: '' } : f);
  const cheapButton = $<HTMLButtonElement>('cheap');
  cheapButton.textContent = cheapLimit === undefined ? t('Günstig') : t('Günstig bis CHF {price}', { price: Number.isInteger(cheapLimit) ? cheapLimit : cheapLimit.toFixed(2) });
  cheapButton.disabled = cheapLimit === undefined && !cheapMode;
  cheapButton.setAttribute('aria-pressed', String(cheapMode));
  cheapButton.title = cheapMode ? t('Günstig-Filter aufheben') : cheapLimit === undefined ? t('Keine passenden Preise vorhanden') : t('Günstige Lokale für die aktuelle Auswahl anzeigen');
  const searchFilters = addressSelection ? { ...f, query: '' } : f;
  const activeFilters = cheapMode ? { ...searchFilters, max: cheapLimit ?? -Infinity, unknown: false } : searchFilters;
  $<HTMLInputElement>('unknown').checked = activeFilters.unknown;
  current = filterBars(districtBars, activeFilters, addressSelection ? [addressSelection.lat, addressSelection.lon] : position);
  // An automatic budget includes every matching venue and displays the highest
  // listed price. Keep it automatic when the selection or available data changes.
  const displayedMax = Number.isFinite(activeFilters.max) ? activeFilters.max : current.reduce((highest, bar) => {
    const offer = bestOffer(bar, activeFilters);
    return offer ? Math.max(highest, cost(offer, activeFilters.mode)) : highest;
  }, 0);
  if (document.activeElement !== $('price')) $<HTMLInputElement>('price').value = Number.isFinite(displayedMax) && displayedMax > 0 ? String(Number(displayedMax.toFixed(2))) : '';
  if (hasBeerSelection(f) && selected && !current.some(bar => bar.id === selected)) {
    selected = undefined;
    syncControls();
  }
  renderDistricts();
  $('count').textContent = coverageLabel(current, f) + (addressSelection ? ` · ${t('Bezugspunkt: {label}', { label: addressSelection.label })}` : '');
  const average = cityAverage(bars, f);
  $('city-average').textContent = t('Schnitt {city} {value}', { city: cityName, value: average ? `CHF ${money(average.price)}` : '—' });
  const comparison = pizza() ? (f.pizzaQuery?.trim() || $<HTMLSelectElement>('pizza-selection').selectedOptions[0]?.textContent || 'Pizza Margherita') : ramen() ? t('Ramen') : coffee() ? (f.coffeeType === 'all' ? t('alle Kaffees & Matcha Latte') : t(coffeeLabels[f.coffeeType!])) : t('Bier · {size} · {mode}', {
    size: f.volume === 'all' ? t('alle Grössen') : f.volume === 'stange' ? 'Stange' : f.volume === '300-330' ? '3 / 3.3 dl' : `${Number(f.volume) / 100} dl`,
    mode: f.mode === 'half' ? t('auf 5 dl umgerechnet') : t('Portionspreis'),
  });
  const beerLabel = f.beerQuery?.trim() || (f.beerSelection ? beerGroupLabels[f.beerSelection] : '');
  const productComparison = hasBeerSelection(f) ? `${beerLabel} · ${comparison}` : comparison;
  $('city-average').title = average
    ? t('{comparison}: Durchschnitt des günstigsten passenden Preises pro Lokal ({count} Lokale). Stadtweit, unabhängig von Suche, Preislimit, Günstig-Filter und Draussen-Filter. Der Lokaltyp zählt mit.', { comparison: productComparison, count: average.count })
    : t('{comparison}: Noch keine passenden Preise für den Stadtdurchschnitt vorhanden.', { comparison: productComparison });
  $('results').innerHTML = current.length ? current.map(b => {
    const o = bestOffer(b, f);
    return `<button class="venue ${selected === b.id ? 'selected' : ''}" data-bar="${e(b.id)}"><span><strong>${e(b.name)}</strong><small>${e(b.address || b.postcode || cityName)}</small>${o && hasBeerSelection(f) ? `<small>${e(o.name)}</small>` : ''}${o && pizza() ? `<small>${e(o.name)}</small>` : o && unit(o) ? `<small>${e(unit(o))}</small>` : ''}</span><span class="venue-price">${o ? money(cost(o, f.mode)) : `<small>${missingPriceLabel(b, f)}</small>`}</span></button>`;
  }).join('') : `<p class="empty">${t('Keine passenden Lokale.')}</p>`;
  layer.clearLayers();
  const venueMarkers = new Map<string, { marker: L.Marker; zIndex: number }>();
  const selectedBar = selectedLocation();
  const mapped = selectedBar && !current.includes(selectedBar) ? [...current, selectedBar] : current;
  for (const b of mapped) {
    const o = bestOffer(b, f);
    const label = `${b.name}: ${o ? `CHF ${money(cost(o, f.mode))}${unit(o) ? ` / ${unit(o)}` : ''}` : t('kein passender Preis')}`;
    const zIndex = b.id === selected ? 2000 : o ? 1000 : 0;
    const marker = L.marker([b.lat, b.lon], {
      icon: L.divIcon({
        className: `marker-wrap${o ? '' : ' unpriced-marker'}${b.id === selected ? ' selected-marker' : ''}`,
        html: o
          ? `<span class="price-marker ${b.id === selected ? 'active' : ''}">${money(cost(o, f.mode))}</span>`
          : `<span class="price-marker unknown ${b.id === selected ? 'active' : ''}">·</span><span class="venue-marker-name">${e(b.name)}</span>`,
        iconSize: o ? [54, 26] : [44, 44],
        iconAnchor: o ? [27, 13] : [22, 22],
      }),
      title: label, alt: label, zIndexOffset: zIndex,
    }).addTo(layer).on('click', () => showBar(b));
    venueMarkers.set(b.id, { marker, zIndex });
  }
  let hoveredVenue: string | undefined, focusedVenue: string | undefined;
  let highlightedMarker: { marker: L.Marker; zIndex: number } | undefined;
  const highlightVenue = () => {
    const next = venueMarkers.get(hoveredVenue || focusedVenue || '');
    if (next === highlightedMarker) return;
    if (highlightedMarker) {
      highlightedMarker.marker.getElement()?.classList.remove('highlighted');
      highlightedMarker.marker.setZIndexOffset(highlightedMarker.zIndex);
    }
    highlightedMarker = next;
    if (next) {
      next.marker.getElement()?.classList.add('highlighted');
      next.marker.setZIndexOffset(10000);
    }
  };
  $('results').querySelectorAll<HTMLButtonElement>('[data-bar]').forEach(button => {
    button.onclick = () => showBar(bars.find(b => b.id === button.dataset.bar)!);
    button.onpointerenter = event => {
      if (event.pointerType === 'touch') return;
      hoveredVenue = button.dataset.bar; highlightVenue();
    };
    button.onpointerleave = () => { hoveredVenue = undefined; highlightVenue(); };
    button.onfocus = () => { focusedVenue = button.dataset.bar; highlightVenue(); };
    button.onblur = () => { focusedVenue = undefined; highlightVenue(); };
  });
  if (selectedBar) detail(selectedBar); else { $('detail').hidden = true; clearGoogleRating(); }
  const zoomPosition = selectedBar ? 'topleft' : 'bottomright';
  if (zoomControl.getPosition() !== zoomPosition) zoomControl.setPosition(zoomPosition);
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
  if (!searchOpen) { closeSearchSuggestions(); return; }
  const showHistory = !f.query.trim();
  const active = suggestions[activeSuggestion];
  const venues = searchSuggestions(searchCandidates(), f.query);
  suggestions = showHistory ? searchHistory.results(searchCandidates())
    : /\d/.test(f.query) ? [...addressResults, ...venues] : [...venues, ...addressResults];
  $('search-history-heading').hidden = !showHistory;
  if (showHistory && !suggestions.length) { closeSearchSuggestions(); return; }
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
function selectSearchSuggestion(index: number, remember = true) {
  const bar = suggestions[index];
  if (!bar) return;
  if (remember) searchHistory.remember(bar);
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
  if (hasBeerSelection(f)) return current;
  // The pizza dataset includes confirmed pizzerias without prices and community
  // pizza entries. Do not add the general restaurant catalogue back to this map.
  const candidates = pizza() || ramen() ? bars : selectableLocations(venues, locationCatalogue);
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
function permitLabel(p: OutdoorPermit) {
  const day = (monthDay: string) => new Date(`2000-${monthDay}T12:00:00Z`).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const season = p.season === 'year' ? t('Boulevard bewilligt, ganzjährig')
    : p.season === 'seasonal' && p.from && p.until ? t('Boulevard bewilligt, {from}–{until}', { from: day(p.from), until: day(p.until) })
    : t('Boulevard bewilligt');
  return p.areaM2 ? `${season} · ${p.areaM2.toLocaleString(dateLocale())} m²` : season;
}
function offerDescription(o: Offer, matches: Offer[]) {
  return [portion(o), offerCategory(o) === 'beer' ? t(beerTypeLabels[effectiveBeerType(o)]) : '',
    offerCategory(o) === 'beer' && o.alcoholFree ? t('alkoholfrei') : '',
    !matches.includes(o) ? t('ausserhalb Filter') : ''].filter(Boolean).join(' · ');
}
function detail(b: Bar) {
  const pizzaVenue = datasets.pizza?.bars.find(venue => venue.id === b.id);
  const matches = matchingOffers(b, f);
  const other = b.offers.filter(o => isCurrentOffer(o) && isComparableOffer(o) && !matches.includes(o));
  const offers = [...matches, ...other];
  const additionalPizzas = pizza() ? pizzaMenuContent((b.pizzaMenu ?? datasets.pizza?.bars.find(venue => venue.id === b.id)?.pizzaMenu ?? []).filter(o => !matches.includes(o))) : '';
  $('detail').innerHTML = `<div class="detail-top"><strong>${e(b.name)}</strong><button id="close-detail">${t('Schliessen')}</button></div><p class="muted">${e(b.address ? [b.address, b.postcode, cityName].filter(Boolean).join(' ') : [b.postcode, cityName, t('Standort: {coordinates}', { coordinates: `${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}` })].filter(Boolean).join(' · '))}</p>${b.outdoorPermit ? `<p class="muted">${e(permitLabel(b.outdoorPermit))}</p>` : ''}<div class="detail-actions"><button id="add-here" class="primary">${t('Preis hinzufügen')}</button><button id="correct-venue">${t('Lokal korrigieren')}</button><button id="share-bar" aria-label="${e(t('{name} teilen', { name: b.name }))}">${t('Teilen')}</button><span class="detail-maps"><a href="${e(googleMapsLink(b, city.name))}" target="_blank" rel="noopener noreferrer" aria-label="${t('In Google Maps öffnen')}" translate="no">Google Maps</a></span></div>${offers.length ? offers.map((o, i) => `<div class="offer ${matches.includes(o) ? '' : 'other-offer'}"><div class="offer-top"><strong>${e(o.name)}</strong><strong class="nowrap">CHF ${money(o.priceChf)}</strong></div>${offerDescription(o, matches) ? `<div class="muted">${e(offerDescription(o, matches))}</div>` : ''}${o.pizzaType && o.ingredients ? `<p class="muted">${e(o.ingredients)}</p>` : ''}${offerCategory(o) === 'beer' && o.beerTypeEstimate && (!o.beerType || o.beerType === 'unknown') ? `<details class="estimate muted"><summary>${t('geschätzt')}</summary><p>${e(o.beerTypeEstimate.reason)}</p></details>` : ''}<div class="offer-meta"><span>${o.photoSource ? `${t('Google-Maps-Foto')} · ${e(o.photoSource.date)} · ` : ''}${o.menuScan ? t('Foto-Upload') : o.confidence === 'community' ? t('Eingetragen') : o.confidence === 'reviewed' ? t('Manuell geprüft') : o.confidence === 'ai' ? t('KI-erkannt') : t('Automatisch erkannt')} · ${e(new Date(o.verifiedMenuDate?.date || o.observedAt).toLocaleDateString(dateLocale()))}</span>${safeUrl(o.sourceUrl) ? `<a href="${safeUrl(o.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Quelle')}</a>` : ''}${o.pizzaType !== 'other' ? `<button data-edit="${i}">${t('Ändern')}</button>` : ''}</div></div>`).join('') : additionalPizzas ? '' : `<p>${t('Noch kein Preis eingetragen.')}</p>`}${additionalPizzas}${safeUrl(b.website) ? `<p><a href="${safeUrl(b.website)}" target="_blank" rel="noopener noreferrer">Website</a></p>` : ''}`;
  $('detail').hidden = false;
  if (f.drink === 'coffee') showCoffeeRating($('detail').querySelector<HTMLElement>('.detail-actions')!, cityId, b.id, communityReady);
  if (pizzaVenue) showGoogleRating($('detail').querySelector<HTMLElement>('.detail-maps')!, cityId, b.id);
  else clearGoogleRating();
  $('close-detail').onclick = () => {
    closeSearchSuggestions();
    selected = undefined; f.query = '';
    render();
  };
  $('add-here').onclick = () => openPrice(b);
  $('correct-venue').onclick = () => {
    if (!communityReady) return toast(t('Gemeinsame Einträge sind gerade nicht verfügbar. Bitte neu laden.'));
    openVenueCorrection(b, venueCorrections.find(item => item.barId === b.id)?.revision || 0);
  };
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
  // Center the venue in the area left visible by the detail panel.
  const point = map.latLngToContainerPoint([b.lat, b.lon]);
  const target = L.point(visibleWidth / 2, visibleHeight / 2);
  const delta = point.subtract(target);
  if (zoom <= map.getZoom() && Math.abs(delta.x) < 1 && Math.abs(delta.y) < 1) return;
  const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (zoom > map.getZoom()) {
    const offset = L.point((mapRect.width - visibleWidth) / 2, (mapRect.height - visibleHeight) / 2);
    const center = map.unproject(map.project([b.lat, b.lon], zoom).add(offset), zoom);
    map.flyTo(center, zoom, { animate, duration: .5 });
  } else {
    map.panBy(delta, { animate, duration: .45 });
  }
}
function showBar(b: Bar, zoom?: number) {
  closeSearchSuggestions(); selected = b.id;
  showView(false); render();
  scheduleBarReveal(zoom);
  $('detail').focus({ preventScroll: true });
}
function chooseDrink(drink: Drink) { if (drink !== f.drink) trackEvent(cityId, 'category_changed', { category: drink }); budgets[f.drink!] = f.max; f.max = budgets[drink]; $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : ''; f.drink = drink; f.mode = 'glass'; selected = undefined; rebuild(); }
$('view-map').onclick = () => showView(false); $('view-list').onclick = () => showView(true);
$('search').oninput = event => {
  cancelAddressRequest(); clearAddressSelection();
  f.query = $<HTMLInputElement>('search').value;
  selected = undefined; activeSuggestion = -1; searchOpen = true;
  render();
  if (!(event as InputEvent).isComposing && f.query.trim().length >= 2) {
    scheduleAddressSearch();
  }
};
$('search').onfocus = () => { searchOpen = true; renderSearchSuggestions(); if (!addressSelection && addressStatus === 'idle') scheduleAddressSearch(); };
$('search-history-clear').onpointerdown = event => event.preventDefault();
$('search-history-clear').onclick = () => {
  searchHistory.clear();
  $('search').focus({ preventScroll: true });
  renderSearchSuggestions();
};
$('search-clear').onpointerdown = event => event.preventDefault();
$('search-clear').onclick = () => {
  cancelAddressRequest(); clearAddressSelection();
  closeSearchSuggestions();
  f.query = ''; selected = undefined;
  searchOpen = true;
  render();
  $('search').focus({ preventScroll: true });
};
$('search').onblur = event => {
  if (event.relatedTarget instanceof Node && $('search-dropdown').contains(event.relatedTarget)) return;
  cancelAddressRequest(); closeSearchSuggestions();
};
$('search-dropdown').addEventListener('focusout', event => {
  if (event.relatedTarget instanceof Node && document.querySelector('.search-box')!.contains(event.relatedTarget)) return;
  cancelAddressRequest(); closeSearchSuggestions();
});
$('search').onkeydown = async event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { cancelAddressRequest(); closeSearchSuggestions(); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); searchOpen = true;
    renderSearchSuggestions();
    if (!suggestions.length) return;
    activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : activeSuggestion < 0 ? 0 : -1) + suggestions.length) % suggestions.length;
    renderSearchSuggestions();
    $(`search-option-${activeSuggestion}`).scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
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
$('price').oninput = () => { rememberCheapMode(false); const n = $<HTMLInputElement>('price').valueAsNumber; f.max = Number.isFinite(n) ? n : Infinity; render(); };
$('price').onblur = () => { if (!Number.isFinite(f.max)) render(); };
$('volume').onchange = () => { selectBeerSize(f, $<HTMLSelectElement>('volume').value); render(); };
$('coffeeType').onchange = () => { f.coffeeType = $<HTMLSelectElement>('coffeeType').value; render(); };
$('pizza-selection').onchange = () => {
  f.pizzaSelection = parsePizzaSelection($<HTMLSelectElement>('pizza-selection').value);
  f.pizzaQuery = undefined;
  render();
};
$('pizza-query').oninput = () => {
  f.pizzaQuery = $<HTMLInputElement>('pizza-query').value;
  if (f.pizzaQuery.trim()) f.pizzaSelection = 'all';
  render();
};
$('beer-query').oninput = () => {
  const query = $<HTMLInputElement>('beer-query').value;
  if (!f.beerQuery?.trim() && query.trim()) f.volume = 'all';
  f.beerQuery = query;
  if (query.trim()) f.beerSelection = undefined;
  selected = undefined;
  render();
};
$('beer-selection').onchange = () => {
  f.beerSelection = parseBeerSelection($<HTMLSelectElement>('beer-selection').value);
  f.beerQuery = undefined;
  if (f.beerSelection) f.volume = 'all';
  selected = undefined;
  render();
};
$('beer-type').onchange = () => {
  f.beerType = $<HTMLSelectElement>('beer-type').value as Filters['beerType'];
  if (f.beerType === 'draft') selectBeerSize(f, 'stange');
  else if (f.beerType === 'all') selectBeerSize(f, '300-330');
  else if (['bottle', 'can'].includes(f.beerType!) && f.volume === 'stange') f.volume = 'all';
  render();
};
$('type').onchange = () => { f.type = $<HTMLSelectElement>('type').value; render(); };
$('sort').onchange = () => { f.sort = $<HTMLSelectElement>('sort').value; if (f.sort === 'distance' && !position && !addressSelection) locate(); else render(); };
for (const [id, key] of [['unknown', 'unknown'], ['outdoor', 'outdoor'], ['alcohol-free', 'alcoholFree']] as const) $(id).onchange = () => { if (key === 'unknown') rememberCheapMode(false); f[key] = $<HTMLInputElement>(id).checked; render(); };
$('normalize').onchange = () => { f.mode = $<HTMLInputElement>('normalize').checked ? 'half' : 'glass'; render(); };
$('filters-toggle').onclick = () => { $('filters').hidden = !$('filters').hidden; $('filters-toggle').setAttribute('aria-expanded', String(!$('filters').hidden)); };
$('reset').onclick = () => {
  cancelAddressRequest(); clearAddressSelection();
  closeSearchSuggestions();
  rememberCheapMode(false);
  districtState.enabled = false; districtState.selected = undefined;
  Object.assign(f, { pizzaSelection: undefined, pizzaQuery: undefined, beerSelection: undefined, beerQuery: undefined, query: '', max: Infinity, volume: '300-330', coffeeType: 'cappuccino', beerType: 'all', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' });
  $<HTMLInputElement>('search').value = ''; $<HTMLInputElement>('price').value = '';
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
  rememberCheapMode(!cheapMode);
  trackEvent(cityId, 'cheap_filter_changed', { category: f.drink!, enabled: cheapMode });
  selected = undefined;
  render();
};
$('data-info').onclick = () => {
  $('coverage').textContent = Object.entries(datasets).map(([drink, data]) => t('{category}: {offers} Angebote aus Karten bei {venues} Lokalen', {
    category: drink === 'pizza' ? 'Pizza Margherita' : drink === 'ramen' ? t('Ramen') : drink === 'beer' ? t('Bier') : t('Kaffee'),
    offers: data.bars.reduce((n, b) => n + b.offers.length, 0), venues: data.bars.filter(b => b.offers.length).length,
  })).join('. ') + `. ${t('{count} gemeinsame Einträge/Korrekturen.', { count: entries.length })}`;
  $<HTMLDialogElement>('info').showModal();
};
for (const format of ['csv', 'json'] as const) {
  $('download-' + format).onclick = () => {
    downloadExport(createExport(cityId, datasets, entries, communityReady, undefined, addedVenues, venueCorrections), format);
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
  name.placeholder = category === 'coffee' ? t('z. B. Espresso') : category === 'ramen' ? t('z. B. Shoyu Ramen') : t('z. B. Lager');
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
  $('menu-scan').hidden = false;
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
    const response = await contributionFetch(`/api/scan-menu?city=${cityId}`, { barId, image, ...(editing ? { edit: { id: editing.communityId, revision: editing.revision || 0, targetKey: editing.originalKey || offerKey(editing), drink: offerCategory(editing) } } : {}) }, 190000);
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
    toast(scanned.pending ? t('Danke. Dein Beitrag wird vor der Veröffentlichung geprüft.') : scanSummary(scanned));
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
    const response = await contributionFetch(pricesApi, input);
    const result = await response.json().catch(() => { throw new Error(t('Speichern gerade nicht möglich. Bitte erneut versuchen.')); });
    if (!response.ok) {
      if (response.status === 409 && await loadCommunity()) rebuild();
      if (response.status === 429 && Number.isFinite(result.retryAfter) && result.retryAfter > 0) {
        throw new Error(t('Maximal 10 Preiseingaben pro 10 Minuten. Bitte warte noch {minutes} Min.', { minutes: Math.ceil(result.retryAfter / 60) }));
      }
      throw new Error(result.error || t('Speichern fehlgeschlagen.'));
    }
    if (result.pending) {
      saved = true; $<HTMLDialogElement>('price-dialog').close();
      toast(t('Danke. Dein Beitrag wird vor der Veröffentlichung geprüft.')); return;
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
    toast(result.pending ? t('Danke. Dein Beitrag wird vor der Veröffentlichung geprüft.') : t('Gespeichert. Für alle sichtbar.'));
  } catch (error) {
    if (!saved) trackEvent(cityId, 'price_failed', { category: drink, action, stage });
    $('form-error').textContent = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name) ? t(error.message) : t('Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.');
    $('form-error').hidden = false;
  } finally { saving = false; $<HTMLButtonElement>('scan-menu').disabled = false; $<HTMLButtonElement>('save-price').disabled = false; $<HTMLButtonElement>('cancel-price').disabled = false; $('save-price').textContent = t('Speichern'); }
};
async function loadCommunity() {
  try {
    const response = await fetch(pricesApi + '&view=public', { credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!Array.isArray(result.entries)) throw new Error();
    entries = result.entries; addedVenues = Array.isArray(result.venues) ? result.venues : []; communityReady = true;
    venueCorrections = Array.isArray(result.venueCorrections) ? result.venueCorrections : [];
    loadCoffeeRatings(result.coffeeRatings);
    customMapUI?.updatePublicMaps(Array.isArray(result.publicMaps) ? result.publicMaps : []);
    return true;
  } catch { communityReady = false; return false; }
}
async function init() {
  const [beerResult, coffeeResult, pizzaResult, ramenResult, loadedCommunity, locationsResult] = await Promise.all([
    fetch(`${dataPath}bars.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    fetch(`${dataPath}coffee.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    fetch(`${dataPath}pizza.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    fetch(`${dataPath}ramen.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
    loadCommunity(),
    fetch(`${dataPath}locations.json`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
  ]);
  if (beerResult) datasets.beer = beerResult;
  if (coffeeResult) datasets.coffee = coffeeResult;
  if (pizzaResult) datasets.pizza = pizzaResult;
  // Ramen is optional: cities without a scraped ramen file simply hide the category.
  if (ramenResult) datasets.ramen = ramenResult;
  locationCatalogue = locationsResult?.bars || [];
  const missing = [!beerResult ? t('Bier') : '', !coffeeResult ? t('Kaffee') : '', !pizzaResult ? 'Pizza' : '', !loadedCommunity ? t('gemeinsame Einträge') : ''].filter(Boolean);
  const hasData = Object.keys(datasets).length > 0;
  for (const format of ['csv', 'json']) $<HTMLButtonElement>('download-' + format).disabled = !hasData;
  $('download-status').textContent = !hasData ? t('Download nicht verfügbar. Bitte lade die Seite erneut.') : missing.length ? t('Unvollständiger Export: {missing} konnten nicht geladen werden. Bitte lade die Seite erneut für einen vollständigen Export.', { missing: missing.join(', ') }) : t('Gemeinsame Einträge und Korrekturen sind enthalten.');
  $<HTMLInputElement>('price').value = Number.isFinite(f.max) ? String(f.max) : '';
  const errors = [!beerResult ? t('Bierdaten konnten nicht geladen werden.') : '', !coffeeResult ? t('Kaffeedaten konnten nicht geladen werden.') : '', !pizzaResult ? t('Pizzadaten konnten nicht geladen werden.') : '', !locationsResult ? t('Zusätzliche Kartenlokale konnten nicht geladen werden. Bitte neu laden.') : ''].filter(Boolean);
  if (errors.length) { $('load-error').textContent = errors.join(' '); $('load-error').hidden = false; }
  rebuild();
  if (initial.has('map')) await customMapUI?.load(initial.get('map')!);
  const linkedId = initial.get('bar');
  if (linkedId) {
    const linkedBar = bars.find(b => b.id === linkedId);
    if (linkedBar) showBar(linkedBar, detailMarkersMinZoom);
    else toast(t('Das geteilte Lokal ist gerade nicht verfügbar.'));
  } else if (f.query.trim() && f.query === initial.get('q')) {
    searchOpen = true;
    if (initial.get('address') === '1') {
      const query = f.query;
      await loadAddressResults();
      if (searchOpen && f.query === query && addressResults.length) {
        selectSearchSuggestion(suggestions.findIndex(result => result === addressResults[0]), false);
      }
    } else scheduleAddressSearch();
  }
}
customMapUI = customMaps(cityId, () => selectableLocations(venues, locationCatalogue), () => { render(); map.invalidateSize(); }, categoryNav);
syncControls();
void init();
void setupTip($<HTMLButtonElement>('tip-coffee'), cityId, toast);
// Account entry is temporarily hidden; contribution verification remains available.
if (districtState.enabled) {
  $('filters').hidden = false; $('filters-toggle').setAttribute('aria-expanded', 'true');
  void loadDistricts();
}
