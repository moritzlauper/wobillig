// The apartment map for Zürich: listings collected by angebunden, shown as a wobillig
// category. It keeps the category row, status row and price slider of the price maps and
// swaps the food and drink controls, list and map for its own while it is open.
// Filters, saved listings and alerts follow angebunden's apartment search; the filter
// rules live in apartment-data.ts and are shared with the alert emails.
import L from 'leaflet';
import { contributionFetch } from './contribution-security';
import { createDistrictLookup, type Districts } from './districts';
import { dateLocale, locale, t } from './i18n';
import { escapeHtml as e, safeUrl } from './data';
import type { categoryNavigation } from './category-navigation';
import {
  apartmentDurationLabels, apartmentFacts, apartmentFeatureLabels, apartmentFeatures, apartmentKindLabels, apartmentKinds,
  apartmentSortLabels, apartmentSourceNames, apartmentSources, chf, describeApartmentFilter, emptyApartmentFilter,
  cheapActive, filterApartments, CHEAP_SHARE, otherPortals, parseApartmentFilter, roomsLabel, sortApartments, DAY_MS,
  type Apartment, type ApartmentData, type ApartmentFilter,
} from './apartment-data';
import { APARTMENT_SMART_MAX, applyApartmentQuery, type ApartmentQuery } from './apartment-smart';
import { parseApartmentRules } from './apartment-rules';

export const APARTMENT_MAP_ID = 'wohnungen';
// The same key the price map uses to remember the last category in Zürich.
const CATEGORY_KEY = 'wobillig-category:zurich';
const DEFAULT_DURATION = emptyApartmentFilter().dauer;
const RAW_DATA = 'https://raw.githubusercontent.com/moritzlauper/angebunden/wohnungen/wohnungen.json';
const ZURICH: [number, number] = [47.378, 8.535];
const PAGE = 150, DETAIL_ZOOM = 16, MAX_LABELS = 400;
// Drawing an area: hold the map this long without moving, then trace the area.
const HOLD_MS = 450, HOLD_TOLERANCE = 10, DRAW_STEP = 6, MAX_AREA_POINTS = 200, RENT_STEP = 50;
const storage = {
  filter: 'wobillig:apartments:filter', version: 'wobillig:apartments:version', saved: 'wobillig:apartments:saved', hidden: 'wobillig:apartments:hidden', alerts: 'wobillig:apartments:alerts',
};
type StoredAlert = { token: string; name: string; status: 'pending' | 'active' | 'gone' };

function readJson<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The map works without local storage. */ }
}

// Tokens from email links are read once and removed from the address right away.
const linkParams = new URLSearchParams(location.search);
const linkConfirm = linkParams.get('bestaetigen'), linkUnsubscribe = linkParams.get('abmelden'), linkListing = linkParams.get('inserat');
// The listing's original link travels along: a listing merged with a duplicate from another portal changes its id.
const linkUrl = linkParams.get('u');
if (linkParams.get('map') === APARTMENT_MAP_ID && (linkConfirm || linkUnsubscribe || linkListing || linkUrl)) {
  const clean = new URL(location.href);
  for (const key of ['bestaetigen', 'abmelden', 'inserat', 'u']) clean.searchParams.delete(key);
  history.replaceState(history.state, '', clean);
}

export function apartments(navigation: ReturnType<typeof categoryNavigation>, onClose: () => void, toast: (message: string) => void) {
  const app = document.getElementById('app')!;
  const toolbar = app.querySelector<HTMLElement>('.toolbar')!;
  let data: ApartmentData | undefined, loading: Promise<void> | undefined, loadFailed = false, isOpen = false;
  let filter: ApartmentFilter = parseApartmentFilter(readJson<unknown>(storage.filter, emptyApartmentFilter()));
  // «Unbefristet» became the default on 9 November 2026; filters saved before still said «alle».
  // On the same day the kind «Wohnung» became the default instead of every kind.
  const version = readJson<number>(storage.version, 0);
  if (version < 3) {
    if (version < 2 && filter.dauer === 'alle') filter = { ...filter, dauer: 'unbefristet' };
    if (filter.arten.length === apartmentKinds.length) filter = { ...filter, arten: emptyApartmentFilter().arten };
    writeJson(storage.version, 3); writeJson(storage.filter, filter);
  }
  let saved = new Set(readJson<string[]>(storage.saved, []).filter(id => typeof id === 'string'));
  let hidden = new Set(readJson<string[]>(storage.hidden, []).filter(id => typeof id === 'string'));
  let alerts = readJson<StoredAlert[]>(storage.alerts, []).filter(item => item && typeof item.token === 'string' && typeof item.name === 'string');
  let shown = PAGE, selected: string | undefined, matching: Apartment[] = [], cheapApplied = false;
  let districtOf: ((location: { lat: number; lon: number }) => number | undefined) | undefined, districts: Districts | undefined;
  let map: L.Map | undefined, dots: L.LayerGroup | undefined, labels: L.LayerGroup | undefined, areas: L.LayerGroup | undefined, drawLayer: L.LayerGroup | undefined;
  let drawing: L.LatLng[] | undefined, refreshTimer: ReturnType<typeof setInterval> | undefined;
  // The rent slider: cheapest to most expensive rent of the current selection, «Günstig» (the cheapest third) in the middle.
  let rentLow = 0, rentHigh = 1, rentMid: number | undefined, renderFrame = 0;
  // A finger needs more than the dot itself: taps within 10 px still hit it.
  const renderer = L.canvas({ padding: 0.3, tolerance: 10 });
  const OUTLINE_PANE = 'apartmentOutlines';
  let outlineRenderer: L.Renderer | undefined;
  const outlines = () => outlineRenderer ||= L.svg({ pane: OUTLINE_PANE });
  // The applied smart search sentence stays in the field, like on the price maps.
  let smartText = '', smartRequest = 0, previousCategory: string | null = null;

  const menuButton = document.createElement('button');
  menuButton.type = 'button'; menuButton.id = 'category-apartments'; menuButton.dataset.apartments = 'true';
  menuButton.textContent = t('Wohnungen');
  navigation.setExtraCategory(menuButton, () => void open());
  navigation.onLeave(() => { if (isOpen) close(); });

  // Examples take turns in the empty search field, like on the price maps, and stop after the last one.
  const placeholderExamples = ['3 Zimmer bis 3000 mit Balkon im Kreis 3', 'WG-Zimmer unter 900 im Kreis 4 oder 5', 'Helle Altbauwohnung im Seefeld',
    'Studio unbefristet bis 1800', 'Ab 4 Zimmer mit Lift und Haustieren', 'Möbliert und befristet im Kreis 6', '2.5 Zimmer ab 60 m2 in Wiedikon'].map(text => t(text));
  let placeholderIndex = 1, placeholderTimer: ReturnType<typeof setTimeout> | undefined, placeholderInterval: ReturnType<typeof setInterval> | undefined;
  function rotatePlaceholder() {
    const field = input('apartment-smart');
    if (placeholderIndex >= placeholderExamples.length) { clearInterval(placeholderInterval); return; }
    if (document.hidden || !isOpen || field.value || document.activeElement === field) return;
    field.classList.add('placeholder-out');
    clearTimeout(placeholderTimer);
    placeholderTimer = setTimeout(() => {
      if (!document.hidden && !field.value && document.activeElement !== field) field.placeholder = placeholderExamples[placeholderIndex++];
      field.classList.remove('placeholder-out');
      if (placeholderIndex >= placeholderExamples.length) clearInterval(placeholderInterval);
    }, 220);
  }
  const kindOptions = apartmentKinds.map(kind => `<option value="${kind}">${e(t(apartmentKindLabels[kind]))}</option>`).join('');
  const roomSteps = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6];
  const roomOptions = (empty: string) => `<option value="">${e(empty)}</option>` + roomSteps.map(n => `<option value="${n}">${e(roomsLabel(n))}</option>`).join('');
  // The controls take the place of the food and drink controls in the toolbar, next to the categories.
  const controls = document.createElement('div');
  controls.id = 'apartment-controls'; controls.className = 'apartment-controls'; controls.hidden = true;
  controls.innerHTML = `<div class="apartment-search-row"><button type="button" id="apartment-back" class="apartment-back" aria-label="${t('Zurück zu den Kategorien')}" title="${t('Zurück zu den Kategorien')}"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <form id="apartment-search" class="apartment-search" role="search"><input id="apartment-smart" type="search" role="combobox" maxlength="${APARTMENT_SMART_MAX}" placeholder="${e(placeholderExamples[0])}" aria-label="${t('Wohnung in eigenen Worten suchen')}" enterkeyhint="search" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="apartment-dropdown"><div id="apartment-dropdown" role="listbox" aria-label="${t('Smart-Suche')}" hidden></div></form></div>
    <span class="apartment-rooms" role="group" aria-label="${t('Zimmer')}"><select id="apartment-rooms-min" aria-label="${t('Zimmer ab')}">${roomOptions(t('Zimmer ab'))}</select><select id="apartment-rooms-max" aria-label="${t('Zimmer bis')}">${roomOptions(t('bis'))}</select></span>
    <select id="apartment-kind" aria-label="${t('Art')}"><option value="">${t('Alle Arten')}</option>${kindOptions}<option value="mixed" disabled hidden>${t('Mehrere Arten')}</option></select>
    <button id="apartment-filters-toggle" type="button" aria-expanded="false" aria-controls="apartment-filters">${t('Filter')} <span id="apartment-filter-count"></span><span class="filter-chevron" aria-hidden="true"></span></button>`;
  toolbar.append(controls);
  const view = document.createElement('section');
  view.id = 'apartment-view'; view.hidden = true; view.setAttribute('aria-label', t('Wohnungen Zürich'));
  view.innerHTML = `<div id="apartment-filters" class="apartment-filters" hidden>
    <fieldset><legend>${t('Art')}</legend>${apartmentKinds.map(kind => `<label><input type="checkbox" name="kind" value="${kind}"> ${e(t(apartmentKindLabels[kind]))}</label>`).join('')}</fieldset>
    <fieldset><legend>${t('Lage')}</legend>
      <details class="apartment-districts-box"><summary>${t('Kreise')}: <span id="apartment-district-summary">${t('Alle Kreise')}</span></summary>
      <span class="apartment-districts" role="group" aria-label="${t('Kreise')}">${Array.from({ length: 12 }, (_, k) => `<label><input type="checkbox" name="district" value="${k + 1}"> ${e(t('Kreis {number}', { number: k + 1 }))}</label>`).join('')}</span></details>
      <button type="button" id="apartment-draw">${t('Gebiet einzeichnen')}</button>
      <span class="muted apartment-draw-help">${t('Oder lange auf die Karte drücken und das Gebiet umfahren.')}</span>
    </fieldset>
    <fieldset><legend>${t('Wohnung')}</legend>
      <label>${t('Fläche ab')} <input id="apartment-area" type="number" min="0" max="2000" step="5" inputmode="numeric" placeholder="m2" aria-label="${t('Fläche ab m2')}"></label>
      <label>${t('Dauer')} <select id="apartment-duration">${Object.entries(apartmentDurationLabels).map(([value, label]) => `<option value="${value}">${e(t(label))}</option>`).join('')}</select></label>
    </fieldset>
    <fieldset><legend>${t('Ausstattung laut Inserat')}</legend>${apartmentFeatures.map(feature => `<label><input type="checkbox" name="feature" value="${feature}"> ${e(t(apartmentFeatureLabels[feature]))}</label>`).join('')}</fieldset>
    <fieldset><legend>${t('Quellen')}</legend><span id="apartment-sources"></span></fieldset>
    <fieldset><legend>${t('Anzeige')}</legend>
      <label><input type="checkbox" id="apartment-new"> ${t('Nur neue (24 Stunden)')}</label>
      <label><input type="checkbox" id="apartment-saved"> ${t('Nur gemerkte')}</label>
      <label><input type="checkbox" id="apartment-doubt"> ${t('Tausch und Betrugsverdacht ausblenden')}</label>
      <button type="button" id="apartment-unhide" class="text-button" hidden></button>
    </fieldset>
    <p class="apartment-portals muted">${t('Weitere Portale mit dieser Suche:')} <span id="apartment-portals"></span></p>
    <button type="button" id="apartment-reset">${t('Zurücksetzen')}</button>
  </div>
  <div id="apartment-chips" class="smart-chips" role="group" aria-label="${t('Aktive Filter')}" hidden></div>
  <div class="status-row"><div class="status-summary" role="status"><strong id="apartment-average"></strong><span id="apartment-summary">${t('Laden …')}</span></div><div class="mobile-switch" role="group" aria-label="${t('Ansicht')}"><button type="button" id="apartment-show-map" aria-pressed="true">${t('Karte')}</button><button type="button" id="apartment-show-list" aria-pressed="false">${t('Liste')}</button></div><div class="status-meta"><button type="button" id="apartment-alert-open" class="text-button">${t('Suchabo per E-Mail')}</button></div></div>
  <p id="apartment-error" role="alert" hidden></p>
  <div class="apartment-content">
    <aside class="apartment-list" aria-label="${t('Wohnungen')}"><div class="list-tools"><select id="apartment-sort" aria-label="${t('Sortierung')}">${Object.entries(apartmentSortLabels).map(([value, label]) => `<option value="${value}">${e(t(label))}</option>`).join('')}</select></div><div id="apartment-results"></div></aside>
    <div class="apartment-map-panel"><div id="apartment-canvas" role="region" aria-label="${t('Karte')}"></div>
      <div class="map-actions"><div class="price-range"><button id="apartment-cheap" type="button" aria-pressed="true" title="${t('Zeigt je Art und Zimmerzahl das günstigste Drittel.')}">${t('Günstig')}</button><div id="apartment-price" class="price-slider" role="slider" tabindex="0" aria-label="${t('Höchstmiete in CHF')}" aria-disabled="true"><span class="price-end" id="apartment-price-min"></span><div class="price-rail"><div class="price-track"><div class="price-fill"></div><div class="price-thumb"></div></div></div><span class="price-end" id="apartment-price-max"></span></div></div></div>
      <div id="apartment-draw-hint" class="apartment-draw-hint" hidden><span role="status"></span><button type="button" id="apartment-draw-cancel" hidden>${t('Abbrechen')}</button></div>
      <section id="apartment-detail" tabindex="-1" aria-label="${t('Wohnung')}" hidden></section></div>
  </div>`;
  toolbar.after(view);

  const alertDialog = document.createElement('dialog');
  alertDialog.id = 'apartment-alert-dialog'; alertDialog.setAttribute('aria-labelledby', 'apartment-alert-title');
  alertDialog.innerHTML = `<form class="apartment-form">
    <div class="dialog-top"><strong id="apartment-alert-title">${t('Suchabo per E-Mail')}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
    <p>${t('Du bekommst eine E-Mail, sobald eine neue Wohnung zu diesen Filtern passt.')}</p>
    <p class="apartment-alert-search"><strong id="apartment-alert-name"></strong><br><span class="muted" id="apartment-alert-count"></span></p>
    <label>${t('E-Mail-Adresse')}<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
    <p class="muted">${t('Zuerst kommt ein Bestätigungslink. Jede E-Mail hat einen Abmeldelink. Kein Newsletter.')}</p>
    <button class="primary" type="submit">${t('Suchabo anlegen')}</button>
    <p role="alert" data-error hidden></p>
    <p role="status" data-done hidden></p>
  </form><section id="apartment-my-alerts" hidden><h3>${t('Meine Suchabos')}</h3><div></div></section>`;
  document.body.append(alertDialog);

  // The controls sit in the shared toolbar, so elements are looked up in the document.
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = (id: string) => el<HTMLInputElement>(id);
  const select = (id: string) => el<HTMLSelectElement>(id);
  const money = (n: number | null) => n == null ? t('Preis auf Anfrage') : `CHF ${chf(n)}`;
  const tr = (text: string, vars?: Record<string, string | number>) => t(text, vars);
  const context = () => ({ now: Date.now(), saved, district: districtOf });

  // --- Filter state -------------------------------------------------------
  function save() {
    writeJson(storage.filter, filter);
    writeJson(storage.saved, [...saved]);
    writeJson(storage.hidden, [...hidden]);
  }
  function change(update: Partial<ApartmentFilter>) {
    filter = parseApartmentFilter({ ...filter, ...update });
    shown = PAGE; save(); syncControls(); render();
  }
  function syncControls() {
    if (document.activeElement !== input('apartment-smart')) input('apartment-smart').value = smartText;
    select('apartment-rooms-min').value = filter.zimmerMin == null ? '' : String(filter.zimmerMin);
    select('apartment-rooms-max').value = filter.zimmerMax == null ? '' : String(filter.zimmerMax);
    const kind = select('apartment-kind');
    kind.value = filter.arten.length === apartmentKinds.length ? '' : filter.arten.length === 1 ? filter.arten[0] : 'mixed';
    view.querySelectorAll<HTMLInputElement>('[name=kind]').forEach(box => { box.checked = filter.arten.includes(box.value as Apartment['art']); });
    view.querySelectorAll<HTMLInputElement>('[name=feature]').forEach(box => { box.checked = filter.merkmale.includes(box.value as never); });
    view.querySelectorAll<HTMLInputElement>('[name=district]').forEach(box => { box.checked = filter.kreise.includes(Number(box.value)); });
    // The Kreise stay folded; the summary names the choice.
    el('apartment-district-summary').textContent = !filter.kreise.length ? t('Alle Kreise') : filter.kreise.length === 1 ? t('Kreis {number}', { number: filter.kreise[0] }) : t('Kreise {numbers}', { numbers: filter.kreise.join(', ') });
    input('apartment-area').value = filter.flaecheMin == null ? '' : String(filter.flaecheMin);
    select('apartment-duration').value = filter.dauer;
    input('apartment-new').checked = filter.nurNeu;
    input('apartment-saved').checked = filter.nurGemerkt;
    input('apartment-doubt').checked = filter.ohneZweifel;
    select('apartment-sort').value = filter.sorte;
    const unhide = el<HTMLButtonElement>('apartment-unhide');
    unhide.hidden = !hidden.size;
    unhide.textContent = t('Ausgeblendete wieder zeigen ({count})', { count: hidden.size });
    el('apartment-portals').innerHTML = otherPortals(filter).map(portal => `<a href="${e(portal.url)}" target="_blank" rel="noopener noreferrer">${e(portal.name)}</a>`).join(', ');
    renderSources();
  }
  function renderSources() {
    const counts = new Map<string, number>();
    for (const item of data?.inserate || []) for (const link of new Set(item.links.map(l => l.quelle))) counts.set(link, (counts.get(link) || 0) + 1);
    const failed = new Set((data?.quellen || []).filter(q => !q.ok).map(q => q.id));
    el('apartment-sources').innerHTML = apartmentSources.filter(source => counts.has(source) || failed.has(source)).map(source =>
      `<label><input type="checkbox" name="source" value="${source}"${filter.quellenAus.includes(source) ? '' : ' checked'}> ${e(apartmentSourceNames[source])} <span class="muted">${failed.has(source) ? e(t('ausgefallen')) : chf(counts.get(source) || 0)}</span></label>`).join('');
  }
  // Filters in the panel appear as chips, so the toolbar stays short and nothing active is out of sight.
  function chips() {
    const list: { label: string; clear: Partial<ApartmentFilter> }[] = [];
    if (filter.text) list.push({ label: `«${filter.text}»`, clear: { text: '' } });
    if (filter.begriffe.length) list.push({ label: `«${filter.begriffe.join(', ')}»`, clear: { begriffe: [] } });
    if (filter.kreise.length) list.push({ label: filter.kreise.map(n => t('Kreis {number}', { number: n })).join(', '), clear: { kreise: [] } });
    filter.gebiete.forEach((_, k) => list.push({ label: filter.gebiete.length === 1 ? t('Eingezeichnetes Gebiet') : t('Gebiet {number}', { number: k + 1 }), clear: { gebiete: filter.gebiete.filter((__, j) => j !== k) } }));
    if (filter.flaecheMin != null) list.push({ label: t('ab {area} m2', { area: filter.flaecheMin }), clear: { flaecheMin: null } });
    // Permanent is the default; any other duration is a chip that leads back to it.
    if (filter.dauer !== DEFAULT_DURATION) list.push({ label: filter.dauer === 'alle' ? t('Auch befristet') : t(apartmentDurationLabels[filter.dauer]), clear: { dauer: DEFAULT_DURATION } });
    for (const feature of filter.merkmale) list.push({ label: t(apartmentFeatureLabels[feature]), clear: { merkmale: filter.merkmale.filter(item => item !== feature) } });
    if (filter.quellenAus.length) list.push({ label: t('Ohne {sources}', { sources: filter.quellenAus.map(source => apartmentSourceNames[source]).join(', ') }), clear: { quellenAus: [] } });
    if (filter.nurNeu) list.push({ label: t('Nur neue'), clear: { nurNeu: false } });
    if (filter.nurGemerkt) list.push({ label: t('Nur gemerkte'), clear: { nurGemerkt: false } });
    if (filter.ohneZweifel) list.push({ label: t('Ohne Tausch und Betrugsverdacht'), clear: { ohneZweifel: false } });
    const box = el('apartment-chips');
    box.replaceChildren(...list.map(item => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'smart-chip';
      chip.setAttribute('aria-label', t('{filter} entfernen', { filter: item.label }));
      chip.innerHTML = `${e(item.label)} <span aria-hidden="true">×</span>`;
      chip.onclick = () => change(item.clear);
      return chip;
    }));
    box.hidden = !list.length;
    el('apartment-filter-count').textContent = list.length ? `· ${list.length}` : '';
  }

  // --- Rendering ----------------------------------------------------------
  function render() {
    chips();
    if (!data) {
      el('apartment-average').textContent = '';
      el('apartment-summary').textContent = loadFailed ? t('Wohnungen konnten nicht geladen werden.') : t('Laden …');
      syncRent([]);
      return;
    }
    const ctx = context();
    const visible = data.inserate.filter(item => filter.nurGemerkt || !hidden.has(item.id));
    const result = filterApartments(visible, filter, ctx);
    cheapApplied = result.applied;
    matching = sortApartments(result.list, filter.sorte);
    // The average follows the other filters, not the rent limit or «Günstig», like the city average on the price maps.
    const rents = filterApartments(visible, { ...filter, mieteMax: null, guenstig: false }, ctx).list.flatMap(item => item.miete != null && item.miete > 0 ? [item.miete] : []);
    const average = rents.length ? rents.reduce((sum, rent) => sum + rent, 0) / rents.length : undefined;
    // The slider spans the same rents, so it stays put while it moves.
    syncRent([...rents].sort((x, y) => x - y));
    const time = new Date(data.erstellt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
    el('apartment-average').textContent = t('Schnitt {city} {value}', { city: t('Zürich'), value: average !== undefined ? `CHF ${chf(average)}` : '—' });
    el('apartment-summary').textContent = [
      matching.length === 1 ? t('1 Wohnung') : t('{count} Wohnungen', { count: chf(matching.length) }),
      cheapApplied ? t('günstigstes Drittel') : null,
      t('Stand {time}', { time }),
    ].filter(Boolean).join(' · ');
    renderList();
    renderMap();
    renderAreas();
    if (selected && !data.inserate.some(item => item.id === selected)) closeDetail();
  }
  function renderList() {
    const results = el('apartment-results');
    results.replaceChildren();
    if (!matching.length) {
      const empty = document.createElement('p'); empty.className = 'empty';
      empty.textContent = filter.nurGemerkt && !saved.size ? t('Du hast noch keine Wohnung gemerkt.') : t('Keine Wohnung passt zu diesen Filtern. Lockere die Filter oder lege ein Suchabo an.');
      results.append(empty); return;
    }
    const now = Date.now();
    for (const item of matching.slice(0, shown)) {
      const row = document.createElement('button');
      row.type = 'button'; row.className = `venue apartment-row${item.id === selected ? ' selected' : ''}`;
      row.dataset.id = item.id;
      const fresh = now - Date.parse(item.erstGesehen) < DAY_MS;
      row.innerHTML = `<span class="apartment-row-text"><strong>${fresh ? `<span class="smart-badge">${e(t('Neu'))}</span>` : ''}${saved.has(item.id) ? `<span class="apartment-star" aria-label="${e(t('Gemerkt'))}">★</span> ` : ''}${e(item.titel)}</strong><small>${e(apartmentFacts(item, tr).join(' · '))}</small></span><span class="venue-price">${e(money(item.miete))}</span>`;
      row.onclick = () => showDetail(item, true);
      results.append(row);
    }
    if (matching.length > shown) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'apartment-more';
      more.textContent = t('{count} weitere anzeigen', { count: Math.min(PAGE, matching.length - shown) });
      more.onclick = () => { shown += PAGE; renderList(); };
      results.append(more);
    }
  }
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function renderMap() {
    if (!map || !dots || !labels) return;
    dots.clearLayers();
    const fill = css('--primary') || '#262626', edge = css('--surface') || '#fff', active = css('--teal') || '#24636b';
    for (const item of matching) {
      if (item.lat == null || item.lon == null) continue;
      const isSelected = item.id === selected;
      const dot = L.circleMarker([item.lat, item.lon], { renderer, radius: isSelected ? 8 : 5, weight: isSelected ? 3 : 1.5, color: edge, fillColor: isSelected ? active : fill, fillOpacity: 0.9 })
        .on('click', () => showDetail(item, false)).addTo(dots);
      if (hover.matches) dot.bindTooltip(() => preview(item), { direction: 'top', offset: [0, -6], className: 'apartment-preview', opacity: 1 });
    }
    renderLabels();
  }
  // With a mouse, a dot shows a small preview before it is clicked; touch opens the listing directly.
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  function preview(item: Apartment) {
    const photo = safeUrl(item.bild);
    return `${photo ? `<img src="${photo}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<strong>${e(money(item.miete))}</strong><span>${e(item.titel)}</span><small>${e(apartmentFacts(item, tr).join(' · '))}</small>`;
  }
  // Listings show their rent as a label, like the venues on the price map. Only the visible part
  // of the map gets labels; with very many in view, the cheapest get one and the rest stay dots.
  function renderLabels() {
    if (!map || !labels) return;
    labels.clearLayers();
    const bounds = map.getBounds().pad(0.1);
    const inView = matching.filter(item => item.lat != null && item.lon != null && bounds.contains([item.lat, item.lon]));
    const labelled = inView.length <= MAX_LABELS ? inView : [...inView].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || (a.miete ?? Infinity) - (b.miete ?? Infinity)).slice(0, MAX_LABELS);
    for (const item of labelled) {
      if (item.lat == null || item.lon == null) continue;
      const isSelected = item.id === selected;
      const text = item.miete != null ? chf(item.miete) : '?';
      const label = L.marker([item.lat, item.lon], {
        icon: L.divIcon({ className: 'marker-wrap', html: `<span class="price-marker${isSelected ? ' active' : ''}">${e(text)}</span>`, iconSize: [58, 26], iconAnchor: [29, 13] }),
        ...(hover.matches ? {} : { title: `${item.titel}: ${money(item.miete)}` }), alt: `${item.titel}: ${money(item.miete)}`, zIndexOffset: isSelected ? 2000 : 0, keyboard: true,
      }).on('click', () => showDetail(item, false)).addTo(labels);
      if (hover.matches) label.bindTooltip(() => preview(item), { direction: 'top', offset: [0, -14], className: 'apartment-preview', opacity: 1 });
    }
  }
  function renderAreas() {
    if (!map || !areas) return;
    areas.clearLayers();
    const color = css('--teal') || '#24636b';
    if (districts && filter.kreise.length) {
      L.geoJSON(districts.features.filter(feature => filter.kreise.includes(feature.properties.number)) as never, {
        style: { color, weight: 2, fill: true, fillOpacity: 0.04, interactive: false }, pane: OUTLINE_PANE,
        // GeoJSON hands its options to each polygon, the renderer included; the type does not list it.
        ...({ renderer: outlines() } as object),
      }).addTo(areas);
    }
    for (const area of filter.gebiete) {
      L.polygon(area.punkte.map(([lon, lat]) => [lat, lon] as [number, number]), { color, weight: 2, fillOpacity: 0.06, dashArray: '6 4', interactive: false, pane: OUTLINE_PANE, renderer: outlines() }).addTo(areas);
    }
  }

  // --- Rent slider --------------------------------------------------------
  // The same slider as on the price maps: «Günstig» sits in the middle, the right end shows every rent.
  function rentPosition(value: number) {
    if (rentHigh <= rentLow) return 100;
    const mid = rentMid;
    if (mid === undefined || mid <= rentLow || mid >= rentHigh) return (value - rentLow) / (rentHigh - rentLow) * 100;
    return value <= mid ? (value - rentLow) / (mid - rentLow) * 50 : 50 + (value - mid) / (rentHigh - mid) * 50;
  }
  function rentFromPosition(ratio: number) {
    const mid = rentMid;
    if (mid === undefined || mid <= rentLow || mid >= rentHigh) return rentLow + ratio * (rentHigh - rentLow);
    return ratio <= .5 ? rentLow + ratio * 2 * (mid - rentLow) : mid + (ratio - .5) * 2 * (rentHigh - mid);
  }
  function showRent(value: number, cheap: boolean, limit = value) {
    const slider = el('apartment-price'), button = el<HTMLButtonElement>('apartment-cheap');
    slider.style.setProperty('--fill', `${rentPosition(value)}%`);
    slider.setAttribute('aria-valuenow', String(value));
    button.textContent = cheap ? t('Günstig') : t('Bis CHF {price}', { price: chf(limit) });
    button.setAttribute('aria-pressed', String(cheap));
    button.title = cheap ? t('Günstig-Filter aufheben') : t('Zeigt je Art und Zimmerzahl das günstigste Drittel.');
    slider.setAttribute('aria-valuetext', cheap ? t('Günstigstes Drittel') : button.textContent);
  }
  function syncRent(rents: number[]) {
    const slider = el('apartment-price');
    // A few parking spaces and villas would stretch the scale; the ends leave out the outer percent.
    const edge = Math.floor(rents.length / 100);
    rentLow = rents.length ? Math.floor(rents[edge] / RENT_STEP) * RENT_STEP : 0;
    rentHigh = rents.length ? Math.ceil(rents[rents.length - 1 - edge] / RENT_STEP) * RENT_STEP : 1;
    rentMid = rents.length >= 4 ? Math.round(rents[Math.ceil(rents.length * CHEAP_SHARE) - 1] / RENT_STEP) * RENT_STEP : undefined;
    slider.setAttribute('aria-valuemin', String(rentLow)); slider.setAttribute('aria-valuemax', String(rentHigh));
    slider.setAttribute('aria-disabled', String(!rents.length));
    el('apartment-price-min').textContent = rents.length ? chf(rentLow) : '';
    el('apartment-price-max').textContent = rents.length ? chf(rentHigh) : '';
    const cheap = cheapActive(filter);
    const value = cheap && rentMid !== undefined ? rentMid : filter.mieteMax != null ? Math.min(Math.max(filter.mieteMax, rentLow), rentHigh) : rentHigh;
    showRent(value, cheap, !cheap && filter.mieteMax != null ? filter.mieteMax : value);
  }
  function setRentLimit(value: number) {
    if (el('apartment-price').getAttribute('aria-disabled') === 'true') return;
    const rounded = Math.round(value / RENT_STEP) * RENT_STEP;
    const snapped = Math.min(Math.max(rentMid !== undefined && Math.abs(value - rentMid) < RENT_STEP / 2 ? rentMid : rounded, rentLow), rentHigh);
    // Back in the middle is «Günstig» again; the right end shows every rent.
    const cheap = snapped === rentMid;
    filter = parseApartmentFilter({ ...filter, guenstig: cheap, mieteMax: cheap || snapped >= rentHigh ? null : snapped, ...(cheap ? { nurGemerkt: false } : {}) });
    shown = PAGE;
    showRent(snapped, cheap);
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => { save(); render(); });
  }

  // --- Detail -------------------------------------------------------------
  function showDetail(item: Apartment, fromList: boolean) {
    selected = item.id;
    const detail = el('apartment-detail');
    const ago = Math.max(0, Date.now() - Date.parse(item.erstGesehen));
    const seen = ago < 3600000 ? t('Neu seit {minutes} Min.', { minutes: Math.max(1, Math.round(ago / 60000)) })
      : ago < DAY_MS ? t('Neu seit {hours} Std.', { hours: Math.round(ago / 3600000) })
      : t('Online seit {date}', { date: new Date(item.erstGesehen).toLocaleDateString(dateLocale()) });
    const photo = safeUrl(item.bild);
    const features = (item.merkmale || []).map(feature => t(apartmentFeatureLabels[feature])).join(', ');
    detail.innerHTML = `<div class="detail-top"><strong>${e(money(item.miete))}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
      ${photo ? `<a href="${safeUrl(item.links[0].url)}" target="_blank" rel="noopener noreferrer" class="apartment-photo"><img src="${photo}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
      <p class="apartment-title"><strong>${e(item.titel)}</strong></p>
      <p class="muted">${e([t(apartmentKindLabels[item.art]), ...apartmentFacts(item, tr)].join(' · '))}</p>
      ${item.vorsicht ? `<p class="apartment-warning">${t('Vorsicht: Das Inserat zeigt Zeichen für Betrug, etwa einen Vermieter im Ausland oder Zahlung vor der Besichtigung. Nie Geld vor einer Besichtigung überweisen.')}</p>` : ''}
      ${item.tausch ? `<p class="apartment-warning">${t('Wohnungstausch: Die Wohnung gibt es nur gegen eine andere.')}</p>` : ''}
      <dl class="apartment-facts">
        ${item.bezug ? `<dt>${t('Bezug')}</dt><dd>${e(/^\d{4}-\d{2}-\d{2}$/.test(item.bezug) ? item.bezug.split('-').reverse().join('.') : item.bezug)}</dd>` : ''}
        ${item.miete != null && item.flaeche ? `<dt>${t('Pro m2')}</dt><dd>CHF ${e((item.miete / item.flaeche).toFixed(2))}</dd>` : ''}
        ${features ? `<dt>${t('Ausstattung')}</dt><dd>${e(features)}</dd>` : ''}
        <dt>${t('Gefunden')}</dt><dd>${e(seen)}</dd>
      </dl>
      <div class="apartment-links">${item.links.map(link => `<a class="apartment-source" href="${safeUrl(link.url)}" target="_blank" rel="noopener noreferrer">${e(t('Auf {source} ansehen', { source: apartmentSourceNames[link.quelle] || link.quelle }))} ↗</a>`).join('')}</div>
      <div class="detail-actions">
        <button type="button" data-save aria-pressed="${saved.has(item.id)}">${saved.has(item.id) ? `★ ${t('Gemerkt')}` : `☆ ${t('Merken')}`}</button>
        <button type="button" data-hide>${hidden.has(item.id) ? t('Wieder zeigen') : t('Ausblenden')}</button>
        <button type="button" data-share>${t('Teilen')}</button>
      </div>
      <p class="muted apartment-note">${t('Angaben aus dem Inserat, ohne Gewähr.')}</p>`;
    detail.hidden = false;
    detail.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => closeDetail();
    detail.querySelector<HTMLButtonElement>('[data-save]')!.onclick = () => {
      if (saved.has(item.id)) saved.delete(item.id); else saved.add(item.id);
      save(); render(); showDetail(item, false);
    };
    detail.querySelector<HTMLButtonElement>('[data-hide]')!.onclick = () => {
      if (hidden.has(item.id)) hidden.delete(item.id); else { hidden.add(item.id); toast(t('Ausgeblendet. Unter «Filter» zeigst du sie wieder an.')); }
      save(); syncControls(); render();
      if (hidden.has(item.id)) closeDetail(); else showDetail(item, false);
    };
    detail.querySelector<HTMLButtonElement>('[data-share]')!.onclick = async () => {
      const url = new URL(location.href); url.search = ''; url.hash = '';
      url.searchParams.set('map', APARTMENT_MAP_ID); url.searchParams.set('inserat', item.id);
      try {
        if (navigator.share) await navigator.share({ title: item.titel, url: url.href });
        else { await navigator.clipboard.writeText(url.href); toast(t('Link kopiert.')); }
      } catch { /* Sharing cancelled. */ }
    };
    view.querySelectorAll('.apartment-row.selected').forEach(row => row.classList.remove('selected'));
    view.querySelector(`.apartment-row[data-id="${CSS.escape(item.id)}"]`)?.classList.add('selected');
    if (map && item.lat != null && item.lon != null) {
      if (fromList) { showList(false); map.setView([item.lat, item.lon], Math.max(map.getZoom(), DETAIL_ZOOM)); }
      renderMap();
    }
    detail.focus({ preventScroll: true });
  }
  // A listing from an email that is no longer collected: say so where its details would be,
  // with the original link, rather than a toast that is gone before it is read.
  function showGone(url: string | null | undefined) {
    selected = undefined;
    const detail = el('apartment-detail');
    const original = url ? safeUrl(url) : '';
    detail.innerHTML = `<div class="detail-top"><strong>${e(t('Nicht mehr online'))}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
      <p>${e(t('Dieses Inserat steht nicht mehr in den gesammelten Wohnungen. Meist ist es vergeben oder wurde vom Portal entfernt.'))}</p>
      ${original ? `<div class="apartment-links"><a class="apartment-source" href="${e(original)}" target="_blank" rel="noopener noreferrer">${e(t('Originalinserat öffnen'))} ↗</a></div>` : ''}`;
    detail.hidden = false;
    detail.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => closeDetail();
    detail.focus({ preventScroll: true });
  }
  function closeDetail() {
    selected = undefined;
    el('apartment-detail').hidden = true;
    view.querySelectorAll('.apartment-row.selected').forEach(row => row.classList.remove('selected'));
    renderMap();
  }

  // --- Drawing areas ------------------------------------------------------
  // Hold the map still, then trace the area with a finger or the mouse; letting go closes it.
  let hold: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined, lastPoint: L.Point | undefined;
  // Pointers on the map: a second finger means pinch zoom, not drawing.
  const pointers = new Set<number>();
  function cancelHold() { if (hold) clearTimeout(hold.timer); hold = undefined; }
  // «Gebiet einzeichnen» arms the map: the next touch draws right away, without holding.
  let armed = false;
  function drawHint(text: string) {
    el('apartment-draw-hint').querySelector('span')!.textContent = text;
    el('apartment-draw-hint').hidden = !text;
    el('apartment-draw-cancel').hidden = !armed;
  }
  function arm() {
    if (!map) return;
    armed = true;
    closeDetail(); showList(false);
    el('apartment-filters').hidden = true; el('apartment-filters-toggle').setAttribute('aria-expanded', 'false');
    // The browser would pan or scroll with the finger instead of sending its moves.
    el('apartment-canvas').style.touchAction = 'none';
    view.classList.add('apartment-drawing');
    drawHint(t('Gebiet auf der Karte umfahren.'));
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    el('apartment-canvas').style.touchAction = '';
    if (!drawing) { view.classList.remove('apartment-drawing'); drawHint(''); }
  }
  function redrawTrace() {
    drawLayer?.clearLayers();
    if (drawing && drawLayer && drawing.length > 1) L.polyline(drawing, { color: css('--teal') || '#24636b', weight: 3, dashArray: '4 4', interactive: false, pane: OUTLINE_PANE, renderer: outlines() }).addTo(drawLayer);
  }
  function startDrawing(event: PointerEvent) {
    if (!map) return;
    map.dragging.disable();
    closeDetail(); el('apartment-filters').hidden = true; el('apartment-filters-toggle').setAttribute('aria-expanded', 'false');
    lastPoint = map.mouseEventToContainerPoint(event);
    drawing = [map.containerPointToLatLng(lastPoint)];
    armed = false;
    view.classList.add('apartment-drawing');
    drawHint(t('Gebiet umfahren und loslassen.'));
    navigator.vibrate?.(15);
    el('apartment-canvas').setPointerCapture?.(event.pointerId);
  }
  function stopDrawing() {
    if (!drawing) return;
    drawing = undefined; lastPoint = undefined; drawLayer?.clearLayers();
    map?.dragging.enable();
    el('apartment-canvas').style.touchAction = '';
    view.classList.remove('apartment-drawing');
    drawHint('');
  }
  function finishDrawing() {
    const trace = drawing || [];
    stopDrawing();
    // The browser still sends a click after letting go; it must not open the listing below the finger.
    const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
    el('apartment-canvas').addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => el('apartment-canvas').removeEventListener('click', swallow, { capture: true }), 400);
    if (!map || trace.length < 3) { toast(t('Zum Zeichnen den Finger auf der Karte lassen und das Gebiet umfahren.')); return; }
    const box = L.bounds(trace.map(point => map!.latLngToContainerPoint(point)));
    const size = box.getSize();
    if (size.x < 24 && size.y < 24) { toast(t('Das Gebiet ist zu klein. Bitte grösser umfahren.')); return; }
    const step = Math.ceil(trace.length / MAX_AREA_POINTS);
    const points = trace.filter((_, k) => k % step === 0).map(point => [Math.round(point.lng * 1e6) / 1e6, Math.round(point.lat * 1e6) / 1e6] as [number, number]);
    change({ gebiete: [...filter.gebiete, { punkte: points }].slice(-10) });
    toast(t('Gebiet gesetzt. Über das × beim Filter entfernst du es wieder.'));
  }
  function bindDrawing(canvas: HTMLElement) {
    canvas.addEventListener('pointerdown', event => {
      pointers.add(event.pointerId);
      if (pointers.size > 1 || !event.isPrimary || event.button > 0) { cancelHold(); if (drawing) { stopDrawing(); if (armed) disarm(); } return; }
      if (armed) { cancelHold(); startDrawing(event); return; }
      const id = event.pointerId, x = event.clientX, y = event.clientY;
      cancelHold();
      hold = { id, x, y, timer: setTimeout(() => { hold = undefined; if (pointers.size === 1) startDrawing(event); }, HOLD_MS) };
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (hold && event.pointerId === hold.id && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_TOLERANCE) cancelHold();
      if (!drawing || !map) return;
      event.stopPropagation();
      const point = map.mouseEventToContainerPoint(event);
      if (lastPoint && point.distanceTo(lastPoint) < DRAW_STEP) return;
      lastPoint = point;
      drawing.push(map.containerPointToLatLng(point));
      redrawTrace();
    }, true);
    const end = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (hold?.id === event.pointerId) cancelHold();
      if (!drawing) return;
      if (event.type === 'pointercancel') stopDrawing(); else finishDrawing();
    };
    // Letting go outside the map still counts, so the window listens too.
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    el('apartment-draw').onclick = () => arm();
    el('apartment-draw-cancel').onclick = () => disarm();
    // A long press opens no context menu here, it starts drawing.
    canvas.addEventListener('contextmenu', event => event.preventDefault());
  }

  // --- Map and data -------------------------------------------------------
  function ensureMap() {
    if (map) return;
    map = L.map(el('apartment-canvas'), { zoomControl: false, preferCanvas: true }).setView(ZURICH, 13);
    // Kreis and area outlines lie below the dots and take no clicks, so every dot stays tappable.
    const pane = map.createPane(OUTLINE_PANE);
    pane.style.zIndex = '350'; pane.style.pointerEvents = 'none';
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
    areas = L.layerGroup().addTo(map);
    dots = L.layerGroup().addTo(map);
    labels = L.layerGroup().addTo(map);
    drawLayer = L.layerGroup().addTo(map);
    map.on('zoomend moveend', renderLabels);
    bindDrawing(el('apartment-canvas'));
    new ResizeObserver(() => map?.invalidateSize({ pan: false })).observe(el('apartment-canvas'));
  }
  async function fetchData(): Promise<ApartmentData> {
    try {
      const response = await fetch('/api/apartments?data=1', { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(String(response.status));
      return await response.json();
    } catch {
      // Without the API (local development), the published file works directly.
      const response = await fetch(RAW_DATA, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(String(response.status));
      const raw = await response.json();
      return { erstellt: raw.erstellt, quellen: raw.quellen || [], inserate: raw.inserate || [] };
    }
  }
  function load(): Promise<void> {
    loading ||= (async () => {
      try {
        const [fresh] = await Promise.all([fetchData(), districts ? undefined : fetch(`${import.meta.env.BASE_URL}data/districts.json`).then(r => r.ok ? r.json() : undefined).then((value: Districts | undefined) => {
          if (value?.features) { districts = value; districtOf = createDistrictLookup(value); }
        }).catch(() => undefined)]);
        if (!Array.isArray(fresh?.inserate)) throw new Error('Invalid data');
        data = fresh; loadFailed = false;
        el('apartment-error').hidden = true;
        const down = data.quellen.filter(source => !source.ok).map(source => source.name);
        if (down.length) { el('apartment-error').textContent = t('Gerade nicht erreichbar: {sources}. Ihre Inserate vom letzten Abruf bleiben sichtbar.', { sources: down.join(', ') }); el('apartment-error').hidden = false; }
      } catch {
        loadFailed = !data;
        if (!data) { el('apartment-error').textContent = t('Wohnungen konnten nicht geladen werden. Bitte später erneut versuchen.'); el('apartment-error').hidden = false; }
      } finally { loading = undefined; }
      syncControls(); render();
    })();
    return loading;
  }

  // --- Alerts -------------------------------------------------------------
  function storeAlerts() { writeJson(storage.alerts, alerts); }
  function renderMyAlerts() {
    const section = alertDialog.querySelector<HTMLElement>('#apartment-my-alerts')!;
    const list = section.querySelector('div')!;
    const visible = alerts.filter(item => item.status !== 'gone');
    section.hidden = !visible.length;
    list.replaceChildren(...visible.map(item => {
      const line = document.createElement('div'); line.className = 'apartment-my-alert';
      line.innerHTML = `<span><strong>${e(item.name)}</strong><small class="muted">${e(item.status === 'active' ? t('Aktiv') : t('Bestätigung per E-Mail ausstehend'))}</small></span>`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('Abmelden');
      remove.onclick = async () => {
        remove.disabled = true;
        try { await unsubscribe(item.token); } catch (error) { toast(error instanceof Error ? error.message : t('Bitte erneut versuchen.')); remove.disabled = false; }
      };
      line.append(remove);
      return line;
    }));
  }
  async function post(body: object) {
    const response = await fetch('/api/apartments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ? t(result.error) : t('Bitte erneut versuchen.'));
    return result;
  }
  async function unsubscribe(token: string) {
    const result = await post({ action: 'unsubscribe', token });
    alerts = alerts.filter(item => item.token !== token); storeAlerts(); renderMyAlerts();
    toast(result.removed ? t('Suchabo abgemeldet. Du bekommst keine E-Mails mehr dazu.') : t('Dieses Suchabo ist schon abgemeldet.'));
  }
  async function refreshAlerts() {
    if (!alerts.length) return;
    try {
      const result = await post({ action: 'status', tokens: alerts.map(item => item.token) });
      if (!Array.isArray(result.alerts)) return;
      alerts = alerts.map(item => {
        const fresh = result.alerts.find((value: { token: string }) => value.token === item.token);
        return fresh ? { token: item.token, name: typeof fresh.name === 'string' ? fresh.name : item.name, status: fresh.status } : item;
      }).filter(item => item.status !== 'gone');
      storeAlerts(); renderMyAlerts();
    } catch { /* The last known list stays visible. */ }
  }
  const form = alertDialog.querySelector('form')!;
  const formError = form.querySelector<HTMLElement>('[data-error]')!, formDone = form.querySelector<HTMLElement>('[data-done]')!;
  function openAlertDialog() {
    formError.hidden = true; formDone.hidden = true;
    form.querySelector<HTMLButtonElement>('[type=submit]')!.hidden = false;
    form.querySelector<HTMLInputElement>('[name=email]')!.closest('label')!.hidden = false;
    alertDialog.querySelector('#apartment-alert-name')!.textContent = describeApartmentFilter(filter, tr);
    alertDialog.querySelector('#apartment-alert-count')!.textContent = !data ? '' : matching.length === 1 ? t('Heute passt 1 Wohnung.') : t('Heute passen {count} Wohnungen.', { count: chf(matching.length) });
    renderMyAlerts(); void refreshAlerts();
    alertDialog.showModal();
  }
  el('apartment-alert-open').onclick = () => openAlertDialog();
  alertDialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => alertDialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const email = form.querySelector<HTMLInputElement>('[name=email]')!;
    submit.disabled = true; formError.hidden = true;
    try {
      const response = await contributionFetch('/api/apartments', { action: 'subscribe', email: email.value.trim(), filter, locale: locale() });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ? t(result.error) : t('Suchabos sind gerade nicht verfügbar. Bitte später erneut versuchen.'));
      alerts = [{ token: result.token, name: result.name, status: 'pending' as const }, ...alerts.filter(item => item.token !== result.token)].slice(0, 20);
      storeAlerts(); renderMyAlerts();
      formDone.textContent = t('Fast fertig: Wir haben dir einen Link an {email} geschickt. Bestätige ihn, dann ist das Suchabo aktiv.', { email: email.value.trim() });
      formDone.hidden = false; submit.hidden = true; email.closest('label')!.hidden = true; email.value = '';
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : t('Bitte erneut versuchen.'); formError.hidden = false;
    } finally { submit.disabled = false; }
  };

  // --- Controls -----------------------------------------------------------
  const numberValue = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  // Smart search: the rules answer at once, then Claude's reading of the same sentence replaces theirs.
  function applyQuery(query: ApartmentQuery) {
    filter = applyApartmentQuery(filter, query);
    shown = PAGE; save(); syncControls(); render();
  }
  // The dropdown confirms what a sentence will set before it is applied; an empty field offers examples.
  let options: { text: string; example: boolean }[] = [], activeOption = -1;
  function querySummary(text: string) {
    const { rest, ...query } = parseApartmentRules(text);
    const said = /gunstig|billig|preiswert/.test(text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, ''));
    const applied = applyApartmentQuery(emptyApartmentFilter(), { ...query, guenstig: said && query.mieteMax == null });
    const known = describeApartmentFilter(applied, tr);
    return [known === t('Alle Wohnungen') ? '' : known, rest.length ? `«${rest.join(' ')}»` : ''].filter(Boolean).join(' · ') || t('Wohnungen suchen');
  }
  function renderDropdown() {
    const field = input('apartment-smart'), box = el('apartment-dropdown');
    const text = field.value.trim();
    if (document.activeElement !== field) { closeDropdown(); return; }
    options = text ? [{ text, example: false }] : placeholderExamples.slice(0, 4).map(example => ({ text: example, example: true }));
    box.innerHTML = options.map((option, index) => `<button type="button" role="option" tabindex="-1" id="apartment-option-${index}" data-option="${index}" aria-selected="${index === activeOption}" class="smart-option${option.example ? ' smart-example' : ''}"><strong>${e(option.example ? option.text : querySummary(option.text))}</strong><small><span class="smart-badge">${t('Smart-Suche')}</span>${option.example ? t('Beispiel ausprobieren') : e(option.text)}</small></button>`).join('');
    box.hidden = false; field.setAttribute('aria-expanded', 'true');
    if (activeOption >= 0) field.setAttribute('aria-activedescendant', `apartment-option-${activeOption}`); else field.removeAttribute('aria-activedescendant');
    box.querySelectorAll<HTMLButtonElement>('[data-option]').forEach(button => {
      button.onpointerdown = event => event.preventDefault();
      button.onclick = () => { field.value = options[Number(button.dataset.option)].text; void applySentence(); };
    });
  }
  function closeDropdown() {
    activeOption = -1; el('apartment-dropdown').hidden = true;
    input('apartment-smart').setAttribute('aria-expanded', 'false'); input('apartment-smart').removeAttribute('aria-activedescendant');
  }
  input('apartment-smart').oninput = () => {
    activeOption = -1;
    if (!input('apartment-smart').value.trim() && smartText) clearSmart();
    renderDropdown();
  };
  input('apartment-smart').onfocus = () => renderDropdown();
  input('apartment-smart').onblur = () => {
    closeDropdown();
    // Only spaces look empty but would hide the examples; the field is emptied for real.
    const field = input('apartment-smart');
    if (field.value && !field.value.trim()) field.value = '';
  };
  input('apartment-smart').onkeydown = event => {
    if (event.key === 'Escape' && !el('apartment-dropdown').hidden) { event.preventDefault(); closeDropdown(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (el('apartment-dropdown').hidden) renderDropdown();
    const n = options.length;
    activeOption = !n ? -1 : event.key === 'ArrowDown' ? (activeOption + 1) % n : activeOption <= 0 ? n - 1 : activeOption - 1;
    renderDropdown();
  };
  function clearSmart() {
    smartText = ''; ++smartRequest;
    change({ text: '', begriffe: [] });
  }
  el('apartment-search').onsubmit = event => {
    event.preventDefault();
    // Enter on a highlighted example takes that example.
    if (activeOption >= 0 && options[activeOption]) input('apartment-smart').value = options[activeOption].text;
    void applySentence();
  };
  async function applySentence() {
    closeDropdown();
    const sentence = input('apartment-smart').value.trim().slice(0, APARTMENT_SMART_MAX);
    if (!sentence) { clearSmart(); return; }
    input('apartment-smart').blur();
    smartText = sentence;
    const request = ++smartRequest;
    const { rest, ...rules } = parseApartmentRules(sentence);
    applyQuery(rules);
    try {
      const response = await fetch('/api/apartments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'smart', text: sentence }), signal: AbortSignal.timeout(20000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.query) throw new Error(result.error);
      if (request === smartRequest) applyQuery(result.query);
    } catch {
      // Without the server (local development) or when Claude is unavailable, the rules' reading stays.
      if (request === smartRequest && rest.length) toast(t('Nicht berücksichtigt: {words}', { words: rest.join(', ') }));
    }
  }
  // With a rent limit of its own, «Günstig» steps aside; pressing it again drops the limit.
  el('apartment-cheap').onclick = () => cheapActive(filter) ? change({ guenstig: false, mieteMax: null }) : change({ guenstig: true, mieteMax: null, nurGemerkt: false });
  const slider = el('apartment-price');
  const rentAt = (event: PointerEvent) => {
    const track = slider.querySelector('.price-track')!.getBoundingClientRect();
    return rentFromPosition(Math.min(Math.max((event.clientX - track.left) / track.width, 0), 1));
  };
  slider.onpointerdown = event => {
    if (slider.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    slider.setPointerCapture(event.pointerId);
    slider.focus({ preventScroll: true });
    setRentLimit(rentAt(event));
  };
  slider.onpointermove = event => { if (slider.hasPointerCapture(event.pointerId)) setRentLimit(rentAt(event)); };
  slider.onkeydown = event => {
    const current = Number(slider.getAttribute('aria-valuenow'));
    const next = ({ ArrowRight: current + RENT_STEP, ArrowUp: current + RENT_STEP, ArrowLeft: current - RENT_STEP, ArrowDown: current - RENT_STEP,
      PageUp: current + 4 * RENT_STEP, PageDown: current - 4 * RENT_STEP, Home: rentLow, End: rentHigh } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setRentLimit(next);
  };
  select('apartment-rooms-min').onchange = () => {
    const min = numberValue(select('apartment-rooms-min').value);
    change({ zimmerMin: min, zimmerMax: min != null && filter.zimmerMax != null && filter.zimmerMax < min ? null : filter.zimmerMax });
  };
  select('apartment-rooms-max').onchange = () => {
    const max = numberValue(select('apartment-rooms-max').value);
    change({ zimmerMax: max, zimmerMin: max != null && filter.zimmerMin != null && filter.zimmerMin > max ? null : filter.zimmerMin });
  };
  select('apartment-kind').onchange = () => {
    const value = select('apartment-kind').value;
    change({ arten: value ? [value as Apartment['art']] : [...apartmentKinds] });
  };
  view.querySelectorAll<HTMLInputElement>('[name=kind]').forEach(box => {
    box.onchange = () => {
      const next = [...view.querySelectorAll<HTMLInputElement>('[name=kind]:checked')].map(item => item.value as Apartment['art']);
      change({ arten: next.length ? next : [...apartmentKinds] });
    };
  });
  view.querySelectorAll<HTMLInputElement>('[name=feature]').forEach(box => {
    box.onchange = () => change({ merkmale: [...view.querySelectorAll<HTMLInputElement>('[name=feature]:checked')].map(item => item.value as ApartmentFilter['merkmale'][number]) });
  });
  el('apartment-sources').addEventListener('change', () => {
    const on = new Set([...view.querySelectorAll<HTMLInputElement>('[name=source]:checked')].map(item => item.value));
    const off = [...view.querySelectorAll<HTMLInputElement>('[name=source]')].filter(item => !on.has(item.value)).map(item => item.value);
    change({ quellenAus: off as ApartmentFilter['quellenAus'] });
  });
  view.querySelectorAll<HTMLInputElement>('[name=district]').forEach(box => {
    box.onchange = () => change({ kreise: [...view.querySelectorAll<HTMLInputElement>('[name=district]:checked')].map(item => Number(item.value)).sort((a, b) => a - b) });
  });
  input('apartment-area').onchange = () => change({ flaecheMin: numberValue(input('apartment-area').value) });
  select('apartment-duration').onchange = () => change({ dauer: select('apartment-duration').value as ApartmentFilter['dauer'] });
  input('apartment-new').onchange = () => change({ nurNeu: input('apartment-new').checked });
  input('apartment-saved').onchange = () => change({ nurGemerkt: input('apartment-saved').checked });
  input('apartment-doubt').onchange = () => change({ ohneZweifel: input('apartment-doubt').checked });
  select('apartment-sort').onchange = () => change({ sorte: select('apartment-sort').value as ApartmentFilter['sorte'] });
  el('apartment-unhide').onclick = () => { hidden = new Set(); save(); syncControls(); render(); };
  el('apartment-reset').onclick = () => { stopDrawing(); smartText = ''; ++smartRequest; filter = emptyApartmentFilter(); shown = PAGE; save(); syncControls(); render(); };
  el('apartment-filters-toggle').onclick = () => {
    const panel = el('apartment-filters');
    panel.hidden = !panel.hidden;
    el('apartment-filters-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  };
  function showList(list: boolean) {
    view.classList.toggle('apartment-show-list', list);
    el('apartment-show-map').setAttribute('aria-pressed', String(!list));
    el('apartment-show-list').setAttribute('aria-pressed', String(list));
    if (list) el('apartment-detail').hidden = true;
    map?.invalidateSize();
  }
  el('apartment-show-map').onclick = () => showList(false);
  el('apartment-show-list').onclick = () => showList(true);
  view.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (drawing) stopDrawing(); else if (armed) disarm(); else if (!el('apartment-detail').hidden) closeDetail();
  });

  // --- Open and close -----------------------------------------------------
  async function open(listing?: string | null, listingUrl?: string | null) {
    if (!isOpen) {
      if (app.classList.contains('custom-map-active')) document.querySelector<HTMLButtonElement>('#map-back')?.click();
      isOpen = true;
      view.hidden = false; controls.hidden = false; app.classList.add('apartments-active');
      navigation.setExtraActive(true);
      const url = new URL(location.href); url.search = ''; url.searchParams.set('map', APARTMENT_MAP_ID);
      history.replaceState(null, '', url);
      document.getElementById('map-title')!.textContent = t('Wohnungen Zürich');
      document.title = `${t('Wohnungen Zürich')} | wobillig`;
      // Like the other categories, the apartments open again on the next visit.
      try {
        const before = localStorage.getItem(CATEGORY_KEY);
        if (before !== APARTMENT_MAP_ID) previousCategory = before;
        localStorage.setItem(CATEGORY_KEY, APARTMENT_MAP_ID);
      } catch { /* storage blocked */ }
      ensureMap(); syncControls(); render();
      map!.invalidateSize();
      clearInterval(placeholderInterval);
      if (placeholderIndex < placeholderExamples.length) placeholderInterval = setInterval(rotatePlaceholder, 4500);
      clearInterval(refreshTimer);
      // angebunden collects every five minutes; the page looks for news every two.
      refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 120000);
    }
    await load();
    if (listing || listingUrl) {
      const item = data?.inserate.find(entry => entry.id === listing)
        ?? (listingUrl ? data?.inserate.find(entry => entry.links.some(link => link.url === listingUrl)) : undefined);
      if (item) showDetail(item, true);
      else showGone(listingUrl);
    }
  }
  el('apartment-back').onclick = () => { close(); navigation.focusMenu(); };
  // Another category or map takes over; the price map behind it comes back.
  function close() {
    if (!isOpen) return;
    stopDrawing(); disarm(); cancelHold(); clearInterval(refreshTimer); clearInterval(placeholderInterval); alertDialog.close();
    // Back on the price map, the category chosen before the apartments is the one to remember.
    try { if (previousCategory) localStorage.setItem(CATEGORY_KEY, previousCategory); else localStorage.removeItem(CATEGORY_KEY); } catch { /* storage blocked */ }
    isOpen = false;
    view.hidden = true; controls.hidden = true; app.classList.remove('apartments-active');
    navigation.setExtraActive(false);
    const target = new URL(location.href); target.searchParams.delete('map'); history.replaceState(null, '', target);
    onClose();
  }

  /** Handles links from alert emails and shared listings; returns true if the apartment map opened. */
  async function openFromLink(): Promise<boolean> {
    if (linkParams.get('map') !== APARTMENT_MAP_ID) return false;
    const opening = open(linkListing, linkUrl);
    if (linkConfirm) {
      try {
        const result = await post({ action: 'confirm', token: linkConfirm });
        alerts = [{ token: result.token, name: result.name, status: 'active' as const }, ...alerts.filter(item => item.token !== result.token)].slice(0, 20);
        storeAlerts();
        toast(t('Suchabo bestätigt. Du bekommst ab jetzt eine E-Mail, sobald eine neue Wohnung passt.'));
      } catch (error) { toast(error instanceof Error ? error.message : t('Bitte erneut versuchen.')); }
    }
    if (linkUnsubscribe) {
      try { await unsubscribe(linkUnsubscribe); } catch (error) { toast(error instanceof Error ? error.message : t('Bitte erneut versuchen.')); }
    }
    await opening;
    return true;
  }
  return { open, openFromLink, close, get isOpen() { return isOpen; } };
}
