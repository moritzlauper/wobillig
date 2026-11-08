// The apartment map for Zürich: listings collected by angebunden, shown as a wobillig
// map with its own view (the food and drink controls stay hidden while it is open).
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
  cheapActive, filterApartments, otherPortals, parseApartmentFilter, roomsLabel, sortApartments, DAY_MS,
  type Apartment, type ApartmentData, type ApartmentFilter,
} from './apartment-data';

export const APARTMENT_MAP_ID = 'wohnungen';
const RAW_DATA = 'https://raw.githubusercontent.com/moritzlauper/angebunden/wohnungen/wohnungen.json';
const ZURICH: [number, number] = [47.378, 8.535];
const PAGE = 150, LABEL_ZOOM = 16, MAX_LABELS = 250;
const storage = {
  filter: 'wobillig:apartments:filter', saved: 'wobillig:apartments:saved', hidden: 'wobillig:apartments:hidden', alerts: 'wobillig:apartments:alerts',
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
if (linkParams.get('map') === APARTMENT_MAP_ID && (linkConfirm || linkUnsubscribe || linkListing)) {
  const clean = new URL(location.href);
  for (const key of ['bestaetigen', 'abmelden', 'inserat', 'u']) clean.searchParams.delete(key);
  history.replaceState(history.state, '', clean);
}

export function apartments(navigation: ReturnType<typeof categoryNavigation>, onClose: () => void, toast: (message: string) => void) {
  const app = document.getElementById('app')!;
  let data: ApartmentData | undefined, loading: Promise<void> | undefined, loadFailed = false;
  let filter: ApartmentFilter = parseApartmentFilter(readJson<unknown>(storage.filter, emptyApartmentFilter()));
  let saved = new Set(readJson<string[]>(storage.saved, []).filter(id => typeof id === 'string'));
  let hidden = new Set(readJson<string[]>(storage.hidden, []).filter(id => typeof id === 'string'));
  let alerts = readJson<StoredAlert[]>(storage.alerts, []).filter(item => item && typeof item.token === 'string' && typeof item.name === 'string');
  let shown = PAGE, selected: string | undefined, matching: Apartment[] = [], cheapApplied = false;
  let districtOf: ((location: { lat: number; lon: number }) => number | undefined) | undefined, districts: Districts | undefined;
  let map: L.Map | undefined, dots: L.LayerGroup | undefined, labels: L.LayerGroup | undefined, areas: L.LayerGroup | undefined, drawLayer: L.LayerGroup | undefined;
  let drawing: [number, number][] | undefined, refreshTimer: ReturnType<typeof setInterval> | undefined;
  const renderer = L.canvas({ padding: 0.3 });

  const menuButton = document.createElement('button');
  menuButton.type = 'button'; menuButton.dataset.apartments = 'true';
  menuButton.textContent = t('Wohnungen');
  menuButton.onclick = () => { navigation.close(); void open(); };
  navigation.setFeaturedMaps([menuButton]);

  const kindOptions = apartmentKinds.map(kind => `<option value="${kind}">${e(t(apartmentKindLabels[kind]))}</option>`).join('');
  const roomSteps = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6];
  const roomOptions = (empty: string) => `<option value="">${e(empty)}</option>` + roomSteps.map(n => `<option value="${n}">${e(roomsLabel(n))}</option>`).join('');
  const view = document.createElement('section');
  view.id = 'apartment-view'; view.hidden = true;
  view.innerHTML = `<div class="apartment-toolbar">
    <div class="apartment-heading">
      <button type="button" id="apartment-back" aria-label="${t('Zurück')}">←<span class="map-label-full"> ${t('Zurück')}</span></button>
      <div class="apartment-heading-title"><h1 id="apartment-name">${t('Wohnungen Zürich')}</h1><p id="apartment-summary" role="status">${t('Laden …')}</p></div>
      <div id="apartment-view-switch" class="mobile-switch" role="group" aria-label="${t('Ansicht')}"><button type="button" id="apartment-show-map" aria-pressed="true">${t('Karte')}</button><button type="button" id="apartment-show-list" aria-pressed="false">${t('Liste')}</button></div>
    </div>
    <div class="apartment-actions"><button type="button" class="primary" id="apartment-alert-open"><span class="map-label-full">${t('Suchabo per E-Mail')}</span><span class="map-label-short" aria-hidden="true">${t('Suchabo')}</span></button></div>
  </div>
  <div class="toolbar apartment-controls">
    <input id="apartment-text" type="search" maxlength="120" placeholder="${t('Strasse, PLZ oder Stichwort')}" aria-label="${t('Strasse, PLZ oder Stichwort')}" enterkeyhint="search" autocomplete="off">
    <button id="apartment-cheap" type="button" aria-pressed="true" title="${t('Zeigt je Art und Zimmerzahl die günstigere Hälfte. Mit einer eigenen Preisgrenze ist der Filter aus.')}">${t('Günstig')}</button>
    <label class="apartment-rent"><span class="apartment-rent-label">${t('Miete bis')}</span> <input id="apartment-rent" type="number" min="0" max="100000" step="50" inputmode="numeric" placeholder="CHF" aria-label="${t('Miete bis CHF')}"></label>
    <span class="apartment-rooms" role="group" aria-label="${t('Zimmer')}"><select id="apartment-rooms-min" aria-label="${t('Zimmer ab')}">${roomOptions(t('Zimmer ab'))}</select><select id="apartment-rooms-max" aria-label="${t('Zimmer bis')}">${roomOptions(t('bis'))}</select></span>
    <select id="apartment-kind" aria-label="${t('Art')}"><option value="">${t('Alle Arten')}</option>${kindOptions}<option value="mixed" disabled hidden>${t('Mehrere Arten')}</option></select>
    <button id="apartment-filters-toggle" type="button" aria-expanded="false" aria-controls="apartment-filters">${t('Filter')} <span id="apartment-filter-count"></span><span class="filter-chevron" aria-hidden="true"></span></button>
    <button id="apartment-alert-inline" type="button" class="primary">${t('Suchabo')}</button>
  </div>
  <div id="apartment-filters" class="apartment-filters" hidden>
    <fieldset><legend>${t('Art')}</legend>${apartmentKinds.map(kind => `<label><input type="checkbox" name="kind" value="${kind}"> ${e(t(apartmentKindLabels[kind]))}</label>`).join('')}</fieldset>
    <fieldset><legend>${t('Lage')}</legend>
      <label>${t('Kreis')} <select id="apartment-district"><option value="">${t('Alle Kreise')}</option>${Array.from({ length: 12 }, (_, k) => `<option value="${k + 1}">${e(t('Kreis {number}', { number: k + 1 }))}</option>`).join('')}</select></label>
      <button type="button" id="apartment-draw">${t('Gebiet einzeichnen')}</button>
    </fieldset>
    <fieldset><legend>${t('Wohnung')}</legend>
      <label>${t('Fläche ab')} <input id="apartment-area" type="number" min="0" max="2000" step="5" inputmode="numeric" placeholder="m²" aria-label="${t('Fläche ab m²')}"></label>
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
  <div id="apartment-draw-bar" class="apartment-draw-bar" hidden><span id="apartment-draw-help" role="status"></span><button type="button" id="apartment-draw-undo">${t('Rückgängig')}</button><button type="button" id="apartment-draw-cancel">${t('Abbrechen')}</button><button type="button" id="apartment-draw-done" class="primary">${t('Fertig')}</button></div>
  <p id="apartment-error" role="alert" hidden></p>
  <div class="apartment-content">
    <aside class="apartment-list" aria-label="${t('Wohnungen')}"><div class="list-tools"><select id="apartment-sort" aria-label="${t('Sortierung')}">${Object.entries(apartmentSortLabels).map(([value, label]) => `<option value="${value}">${e(t(label))}</option>`).join('')}</select></div><div id="apartment-results"></div></aside>
    <div class="apartment-map-panel"><div id="apartment-canvas" role="region" aria-label="${t('Karte')}"></div><section id="apartment-detail" tabindex="-1" aria-label="${t('Wohnung')}" hidden></section>
      <p class="apartment-credit"><a href="https://angebunden.ch/wohnungen" target="_blank" rel="noopener">${t('Inserate gesammelt von angebunden')}</a></p></div>
  </div>`;
  app.append(view);

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

  const el = <T extends HTMLElement = HTMLElement>(id: string) => view.querySelector<T>('#' + id)!;
  // On phones the label is hidden to keep the controls in three rows, so the field names itself.
  const narrow = matchMedia('(max-width: 760px)');
  const rentPlaceholder = () => { view.querySelector<HTMLInputElement>('#apartment-rent')!.placeholder = narrow.matches ? t('Miete bis CHF') : 'CHF'; };
  rentPlaceholder(); narrow.addEventListener('change', rentPlaceholder);
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
    input('apartment-text').value = filter.text;
    input('apartment-rent').value = filter.mieteMax == null ? '' : String(filter.mieteMax);
    el('apartment-cheap').setAttribute('aria-pressed', String(cheapActive(filter)));
    select('apartment-rooms-min').value = filter.zimmerMin == null ? '' : String(filter.zimmerMin);
    select('apartment-rooms-max').value = filter.zimmerMax == null ? '' : String(filter.zimmerMax);
    const kind = select('apartment-kind');
    kind.value = filter.arten.length === apartmentKinds.length ? '' : filter.arten.length === 1 ? filter.arten[0] : 'mixed';
    view.querySelectorAll<HTMLInputElement>('[name=kind]').forEach(box => { box.checked = filter.arten.includes(box.value as Apartment['art']); });
    view.querySelectorAll<HTMLInputElement>('[name=feature]').forEach(box => { box.checked = filter.merkmale.includes(box.value as never); });
    select('apartment-district').value = filter.kreise.length === 1 ? String(filter.kreise[0]) : '';
    input('apartment-area').value = filter.flaecheMin == null ? '' : String(filter.flaecheMin);
    select('apartment-duration').value = filter.dauer;
    input('apartment-new').checked = filter.nurNeu;
    input('apartment-saved').checked = filter.nurGemerkt;
    input('apartment-doubt').checked = filter.ohneZweifel;
    select('apartment-sort').value = filter.sorte;
    el('apartment-draw').textContent = filter.gebiete.length ? t('Weiteres Gebiet einzeichnen') : t('Gebiet einzeichnen');
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
    if (filter.kreise.length) list.push({ label: filter.kreise.map(n => t('Kreis {number}', { number: n })).join(', '), clear: { kreise: [] } });
    filter.gebiete.forEach((_, k) => list.push({ label: filter.gebiete.length === 1 ? t('Eingezeichnetes Gebiet') : t('Gebiet {number}', { number: k + 1 }), clear: { gebiete: filter.gebiete.filter((__, j) => j !== k) } }));
    if (filter.flaecheMin != null) list.push({ label: t('ab {area} m²', { area: filter.flaecheMin }), clear: { flaecheMin: null } });
    if (filter.dauer !== 'alle') list.push({ label: t(apartmentDurationLabels[filter.dauer]), clear: { dauer: 'alle' } });
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
      el('apartment-summary').textContent = loadFailed ? t('Wohnungen konnten nicht geladen werden.') : t('Laden …');
      return;
    }
    const ctx = context();
    const result = filterApartments(data.inserate.filter(item => filter.nurGemerkt || !hidden.has(item.id)), filter, ctx);
    cheapApplied = result.applied;
    matching = sortApartments(result.list, filter.sorte);
    const priced = matching.filter(item => item.miete != null);
    const average = priced.length ? priced.reduce((sum, item) => sum + item.miete!, 0) / priced.length : undefined;
    const time = new Date(data.erstellt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
    el('apartment-summary').textContent = [
      matching.length === 1 ? t('1 Wohnung') : t('{count} Wohnungen', { count: chf(matching.length) }),
      average !== undefined ? t('Schnitt CHF {price}', { price: chf(average) }) : null,
      cheapApplied ? t('günstigere Hälfte') : null,
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
      L.circleMarker([item.lat, item.lon], { renderer, radius: isSelected ? 8 : 5, weight: isSelected ? 3 : 1.5, color: edge, fillColor: isSelected ? active : fill, fillOpacity: 0.9 })
        .on('click', () => showDetail(item, false)).addTo(dots);
    }
    renderLabels();
  }
  // Zoomed in, the dots become price labels like the venues on the price map.
  function renderLabels() {
    if (!map || !labels) return;
    labels.clearLayers();
    if (map.getZoom() < LABEL_ZOOM) return;
    const bounds = map.getBounds().pad(0.1);
    let count = 0;
    for (const item of matching) {
      if (item.lat == null || item.lon == null || !bounds.contains([item.lat, item.lon])) continue;
      if (++count > MAX_LABELS) break;
      const isSelected = item.id === selected;
      const text = item.miete != null ? chf(item.miete) : '?';
      L.marker([item.lat, item.lon], {
        icon: L.divIcon({ className: 'marker-wrap', html: `<span class="price-marker${isSelected ? ' active' : ''}">${e(text)}</span>`, iconSize: [58, 26], iconAnchor: [29, 13] }),
        title: `${item.titel}: ${money(item.miete)}`, alt: `${item.titel}: ${money(item.miete)}`, zIndexOffset: isSelected ? 2000 : 0, keyboard: true,
      }).on('click', () => showDetail(item, false)).addTo(labels);
    }
  }
  function renderAreas() {
    if (!map || !areas) return;
    areas.clearLayers();
    const color = css('--teal') || '#24636b';
    if (districts && filter.kreise.length) {
      L.geoJSON(districts.features.filter(feature => filter.kreise.includes(feature.properties.number)) as never, {
        style: { color, weight: 2, fill: true, fillOpacity: 0.04, interactive: false },
      }).addTo(areas);
    }
    for (const area of filter.gebiete) {
      L.polygon(area.punkte.map(([lon, lat]) => [lat, lon] as [number, number]), { color, weight: 2, fillOpacity: 0.06, dashArray: '6 4', interactive: false }).addTo(areas);
    }
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
      ${photo ? `<a href="${e(safeUrl(item.links[0].url))}" target="_blank" rel="noopener noreferrer" class="apartment-photo"><img src="${e(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
      <p class="apartment-title"><strong>${e(item.titel)}</strong></p>
      <p class="muted">${e([t(apartmentKindLabels[item.art]), ...apartmentFacts(item, tr)].join(' · '))}</p>
      ${item.vorsicht ? `<p class="apartment-warning">${t('Vorsicht: Das Inserat zeigt Zeichen für Betrug, etwa einen Vermieter im Ausland oder Zahlung vor der Besichtigung. Nie Geld vor einer Besichtigung überweisen.')}</p>` : ''}
      ${item.tausch ? `<p class="apartment-warning">${t('Wohnungstausch: Die Wohnung gibt es nur gegen eine andere.')}</p>` : ''}
      <dl class="apartment-facts">
        ${item.bezug ? `<dt>${t('Bezug')}</dt><dd>${e(/^\d{4}-\d{2}-\d{2}$/.test(item.bezug) ? item.bezug.split('-').reverse().join('.') : item.bezug)}</dd>` : ''}
        ${item.miete != null && item.flaeche ? `<dt>${t('Pro m²')}</dt><dd>CHF ${e((item.miete / item.flaeche).toFixed(2))}</dd>` : ''}
        ${features ? `<dt>${t('Ausstattung')}</dt><dd>${e(features)}</dd>` : ''}
        <dt>${t('Gefunden')}</dt><dd>${e(seen)}</dd>
      </dl>
      <div class="apartment-links">${item.links.map(link => `<a class="apartment-source" href="${e(safeUrl(link.url))}" target="_blank" rel="noopener noreferrer">${e(t('Auf {source} ansehen', { source: apartmentSourceNames[link.quelle] || link.quelle }))} ↗</a>`).join('')}</div>
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
      if (fromList) { showList(false); map.setView([item.lat, item.lon], Math.max(map.getZoom(), LABEL_ZOOM)); }
      renderMap();
    }
    detail.focus({ preventScroll: true });
  }
  function closeDetail() {
    selected = undefined;
    el('apartment-detail').hidden = true;
    view.querySelectorAll('.apartment-row.selected').forEach(row => row.classList.remove('selected'));
    renderMap();
  }

  // --- Drawing areas ------------------------------------------------------
  function drawStatus() {
    const points = drawing?.length || 0;
    el('apartment-draw-help').textContent = points < 3 ? t('Tippe auf die Karte, um die Ecken des Gebiets zu setzen (noch {count}).', { count: 3 - points }) : t('{count} Ecken gesetzt. Weitere Ecken setzen oder «Fertig».', { count: points });
    el<HTMLButtonElement>('apartment-draw-done').disabled = points < 3;
    el<HTMLButtonElement>('apartment-draw-undo').disabled = points === 0;
    drawLayer?.clearLayers();
    if (drawing && drawLayer) {
      const color = css('--teal') || '#24636b';
      const latlngs = drawing.map(([lon, lat]) => [lat, lon] as [number, number]);
      if (latlngs.length > 1) L.polyline(latlngs.length > 2 ? [...latlngs, latlngs[0]] : latlngs, { color, weight: 2, dashArray: '4 4', interactive: false }).addTo(drawLayer);
      for (const point of latlngs) L.circleMarker(point, { renderer, radius: 5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, interactive: false }).addTo(drawLayer);
    }
  }
  function startDrawing() {
    drawing = [];
    el('apartment-filters').hidden = true; el('apartment-filters-toggle').setAttribute('aria-expanded', 'false');
    el('apartment-draw-bar').hidden = false;
    showList(false); closeDetail();
    view.classList.add('apartment-drawing');
    drawStatus();
  }
  function stopDrawing() {
    drawing = undefined; drawLayer?.clearLayers();
    el('apartment-draw-bar').hidden = true;
    view.classList.remove('apartment-drawing');
  }
  el('apartment-draw').onclick = () => startDrawing();
  el('apartment-draw-undo').onclick = () => { drawing?.pop(); drawStatus(); };
  el('apartment-draw-cancel').onclick = () => stopDrawing();
  el('apartment-draw-done').onclick = () => {
    if (!drawing || drawing.length < 3) return;
    const area = { punkte: drawing };
    stopDrawing();
    change({ gebiete: [...filter.gebiete, area].slice(-10) });
  };

  // --- Map and data -------------------------------------------------------
  function ensureMap() {
    if (map) return;
    map = L.map(el('apartment-canvas'), { zoomControl: false, preferCanvas: true }).setView(ZURICH, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    areas = L.layerGroup().addTo(map);
    dots = L.layerGroup().addTo(map);
    labels = L.layerGroup().addTo(map);
    drawLayer = L.layerGroup().addTo(map);
    map.on('zoomend moveend', renderLabels);
    map.on('click', event => {
      if (!drawing) return;
      drawing.push([Math.round(event.latlng.lng * 1e6) / 1e6, Math.round(event.latlng.lat * 1e6) / 1e6]);
      drawStatus();
    });
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
        menuButton.textContent = t('Wohnungen · {count} Inserate', { count: chf(data.inserate.length) });
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
  el('apartment-alert-inline').onclick = () => openAlertDialog();
  alertDialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => alertDialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const email = form.querySelector<HTMLInputElement>('[name=email]')!;
    submit.disabled = true; formError.hidden = true;
    try {
      const response = await contributionFetch('/api/apartments', { action: 'subscribe', email: email.value.trim(), filter, locale: locale() });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ? t(result.error) : t('Bitte erneut versuchen.'));
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
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  input('apartment-text').oninput = () => { clearTimeout(textTimer); textTimer = setTimeout(() => change({ text: input('apartment-text').value }), 250); };
  // With a rent limit of its own, «Günstig» steps aside; pressing it again drops the limit.
  el('apartment-cheap').onclick = () => cheapActive(filter) ? change({ guenstig: false }) : change({ guenstig: true, mieteMax: null, nurGemerkt: false });
  input('apartment-rent').onchange = () => change({ mieteMax: numberValue(input('apartment-rent').value) });
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
  select('apartment-district').onchange = () => { const n = numberValue(select('apartment-district').value); change({ kreise: n ? [n] : [] }); };
  input('apartment-area').onchange = () => change({ flaecheMin: numberValue(input('apartment-area').value) });
  select('apartment-duration').onchange = () => change({ dauer: select('apartment-duration').value as ApartmentFilter['dauer'] });
  input('apartment-new').onchange = () => change({ nurNeu: input('apartment-new').checked });
  input('apartment-saved').onchange = () => change({ nurGemerkt: input('apartment-saved').checked });
  input('apartment-doubt').onchange = () => change({ ohneZweifel: input('apartment-doubt').checked });
  select('apartment-sort').onchange = () => change({ sorte: select('apartment-sort').value as ApartmentFilter['sorte'] });
  el('apartment-unhide').onclick = () => { hidden = new Set(); save(); syncControls(); render(); };
  el('apartment-reset').onclick = () => { stopDrawing(); filter = emptyApartmentFilter(); shown = PAGE; save(); syncControls(); render(); };
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
    if (drawing) stopDrawing(); else if (!el('apartment-detail').hidden) closeDetail();
  });

  // --- Open and close -----------------------------------------------------
  async function open(listing?: string | null) {
    navigation.close();
    if (app.classList.contains('custom-map-active')) document.querySelector<HTMLButtonElement>('#map-back')?.click();
    view.hidden = false; app.classList.add('apartments-active');
    const url = new URL(location.href); url.search = ''; url.searchParams.set('map', APARTMENT_MAP_ID);
    history.replaceState(null, '', url);
    document.getElementById('map-title')!.textContent = t('Wohnungen Zürich');
    document.title = `${t('Wohnungen Zürich')} | wobillig`;
    ensureMap(); syncControls(); render();
    map!.invalidateSize();
    el('apartment-back').focus({ preventScroll: true });
    clearInterval(refreshTimer);
    // angebunden collects every five minutes; the page looks for news every two.
    refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 120000);
    await load();
    if (listing) {
      const item = data?.inserate.find(entry => entry.id === listing);
      if (item) showDetail(item, true);
      else toast(t('Dieses Inserat ist nicht mehr online.'));
    }
  }
  el('apartment-back').onclick = () => {
    stopDrawing(); clearInterval(refreshTimer);
    view.hidden = true; app.classList.remove('apartments-active');
    const target = new URL(location.href); target.searchParams.delete('map'); history.replaceState(null, '', target);
    onClose(); navigation.focusMenu();
  };

  /** Handles links from alert emails and shared listings; returns true if the apartment map opened. */
  async function openFromLink(): Promise<boolean> {
    if (linkParams.get('map') !== APARTMENT_MAP_ID) return false;
    const opening = open(linkListing);
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
  return { open, openFromLink, get isOpen() { return !view.hidden; } };
}
