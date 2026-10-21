import L from 'leaflet';
import { cities, type City } from './cities';
import { escapeHtml as e, type Bar } from './data';
import { isMapId, automaticMapStatusLabels, publicMapSummaries, PUBLIC_MAP_MIN_VENUES, mapVenueCount, type AutomaticMapRequest, type MapPlace, type PublicMap, type CustomMap, type MapEntry } from './custom-map-data';
import type { categoryNavigation } from './category-navigation';
import { dateLocale, t } from './i18n';
import { shareLink } from './sharing';
import { venueForm } from './venue-form';
import { searchSuggestions } from './search';
import { googleMapsLink } from './locations';

class MapRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function customMaps(city: City, known: () => Bar[], onClose: () => void, navigation: ReturnType<typeof categoryNavigation>) {
  const app = document.getElementById('app')!;
  const nav = document.getElementById('category-navigation')!;
  const api = `/api/prices?city=${city}`;
  const storageKey = `wobillig:maps:${city}`;
  let saved: { id: string; name: string; automaticStatus?: AutomaticMapRequest['status'] }[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(value)) saved = value.filter(item => item && isMapId(item.id) && typeof item.name === 'string').slice(0, 20);
  } catch { /* Shared links work even without local storage. */ }
  let current: CustomMap | undefined, map: L.Map | undefined, layer: L.LayerGroup | undefined;
  let createId = crypto.randomUUID(), busy = false, request = 0;
  let editing: MapEntry | undefined;
  let lockedVenue = false;
  let publicMaps: PublicMap[] = [];
  const added: Bar[] = [];
  const venues = () => [...new Map([...known(), ...added].map(bar => [bar.id, bar])).values()];
  const plus = document.createElement('button');
  plus.id = 'create-map'; plus.type = 'button'; plus.className = 'create-map-button';
  plus.setAttribute('aria-label', t('Map erstellen')); plus.title = t('Map erstellen');
  plus.innerHTML = '<span aria-hidden="true">+</span>';
  const mine = document.createElement('button');
  mine.id = 'my-maps'; mine.type = 'button'; mine.textContent = t('Meine Maps'); mine.hidden = !saved.length;
  nav.append(plus);
  navigation.setMapLibrary(mine);
  const create = document.createElement('dialog');
  create.id = 'create-map-dialog'; create.setAttribute('aria-labelledby', 'create-map-title');
  create.innerHTML = `<form class="custom-map-form">
    <div class="dialog-top"><strong id="create-map-title">${t('Eigene Map erstellen')}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
    <label>${t('Art der Map')}<select name="mode"><option value="manual">${t('Map selbst erstellen')}</option><option value="automatic">${t('Automatische Map anfragen')}</option></select></label>
    <p data-manual>${t('Ob Essen, Alltagsprodukte oder Dienstleistungen: Erstelle eine Map und sammle Orte mit Preisen.')}</p>
    <label>${t('Name der Map')}<input name="name" required maxlength="60" placeholder="${t('z. B. Döner-Map')}" autocomplete="off"></label>
    <fieldset data-automatic hidden disabled>
      <label>${t('Link zur Angebotsseite')}<input name="sourceUrl" type="url" maxlength="2000" placeholder="https://www.coop.ch/…" required></label>
      <label>${t('Welche Angebote möchtest du sehen?')}<textarea name="description" rows="3" maxlength="600" required placeholder="${t('z. B. Kaffeeaktionen bei Coop in Zürich')}"></textarea></label>
      <p class="muted">${t('Wir prüfen die Quelle und ob sich ihre Angebote zuverlässig übernehmen lassen. Die Anfrage startet noch keine automatische Map.')}</p>
    </fieldset>
    <p class="muted">${e(t(cities[city].name))} · <span data-manual>${t('Alle mit dem Link können Preise ansehen und ergänzen.')}</span><span data-automatic-copy hidden>${t('Den Status findest du unter «Meine Maps».')}</span></p>
    <p class="muted" data-manual>${t('Nur per Link erreichbar.')}</p>
    <button class="primary" type="submit">${t('Map erstellen')}</button>
    <p role="alert" data-error hidden></p>
  </form><section id="saved-maps" hidden><h3>${t('Meine Maps')}</h3><div></div></section>`;
  const entry = document.createElement('dialog');
  entry.id = 'map-entry-dialog'; entry.setAttribute('aria-labelledby', 'map-entry-title');
  entry.innerHTML = `<form class="custom-map-form">
    <div class="dialog-top"><strong id="map-entry-title">${t('Lokal und Preis hinzufügen')}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
    <label>${t('Ort oder Geschäft suchen')}<input name="search" type="search" role="combobox" required placeholder="${t('Name oder Adresse')}" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="map-venue-suggestions" aria-describedby="map-venue-search-help"></label>
    <input name="venue" type="hidden">
    <div id="map-venue-suggestions" role="listbox" aria-label="${t('Suchvorschläge')}" hidden></div>
    <p id="map-venue-search-help" class="muted" role="status">${t('Suche im gesamten Bestand nach Name, Adresse oder PLZ und wähle ein Lokal aus.')}</p>
    <small class="map-place-attribution">${t('Orte aus')} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · <a href="https://photon.komoot.io" target="_blank" rel="noopener noreferrer">Photon</a></small>
    <button type="button" id="map-new-venue">${t('Lokal fehlt? Neu hinzufügen')}</button>
    <label>${t('Produkt / Menge')}<input name="product" required maxlength="100" placeholder="${t('z. B. Tampons, Packung mit 16 Stück')}"></label>
    <label>${t('Preis in CHF')}<input name="price" type="number" required min="0.5" max="500" step="0.01" inputmode="decimal"></label>
    <button class="primary" type="submit">${t('Speichern')}</button><p role="alert" data-error hidden></p>
  </form>`;
  document.body.append(create, entry);
  const view = document.createElement('section');
  view.id = 'custom-map-view'; view.hidden = true;
  view.innerHTML = `<div class="custom-map-toolbar">
    <div class="custom-map-heading">
      <button type="button" id="map-back" aria-label="${t('Zurück')}">←<span class="map-label-full"> ${t('Zurück')}</span></button>
      <div class="custom-map-title"><h1 id="custom-map-name"></h1><p id="custom-map-summary" role="status"></p></div>
      <div id="custom-map-view-switch" class="mobile-switch" role="group" aria-label="${t('Ansicht')}"><button type="button" id="custom-view-map" aria-pressed="true" aria-controls="custom-map-canvas">${t('Karte')}</button><button type="button" id="custom-view-list" aria-pressed="false" aria-controls="custom-map-entries">${t('Liste')}</button></div>
    </div>
    <div class="custom-map-actions" id="custom-map-actions">
      <button type="button" id="map-share" aria-label="${t('Map teilen')}"><span class="map-label-full">${t('Map teilen')}</span><span class="map-label-short" aria-hidden="true">${t('Teilen')}</span></button>
      <div id="map-publish-control">
        <button type="button" id="map-publish" aria-label="${t('Für alle veröffentlichen')}" aria-describedby="map-publish-help"><span class="map-label-full">${t('Für alle veröffentlichen')}</span><span class="map-label-short" aria-hidden="true">${t('Veröffentlichen')}</span></button>
      </div>
      <button type="button" id="map-withdraw" aria-label="${t('Veröffentlichung zurückziehen')}" hidden><span class="map-label-full">${t('Veröffentlichung zurückziehen')}</span><span class="map-label-short" aria-hidden="true">${t('Zurückziehen')}</span></button>
      <button type="button" class="primary" id="map-add-entry" aria-label="${t('Lokal und Preis hinzufügen')}"><span class="map-label-full">+ ${t('Lokal und Preis hinzufügen')}</span><span class="map-label-short" aria-hidden="true">+ ${t('Hinzufügen')}</span></button>
      <p id="map-publish-help" class="muted" role="status" hidden></p>
    </div>
    </div><div id="custom-map-created" hidden><span role="status">${t('Nur per Link erreichbar.')}</span><button type="button" data-copy>${t('Link kopieren')}</button><button type="button" data-dismiss aria-label="${t('Schliessen')}">×</button></div>
    <p id="custom-map-visibility" class="muted"></p>
    <p id="custom-map-action-error" role="alert" hidden></p>
    <section id="automatic-map-details" hidden></section>
    <div id="custom-map-share" hidden><label>${t('Diesen Link kopieren und teilen:')}<input type="url" readonly></label></div>
    <div class="custom-map-content"><div class="custom-map-panel"><div id="custom-map-canvas" role="region" aria-label="${t('Eigene Map')}"></div><section id="custom-map-detail" tabindex="-1" aria-label="${t('Lokal')}" hidden></section></div><div id="custom-map-entries"></div></div>`;
  app.append(view);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => view.querySelector<T>('#' + id)!;
  const field = (name: string) => entry.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
  function showView(list: boolean) {
    view.classList.toggle('custom-map-show-list', list);
    el('custom-view-map').setAttribute('aria-pressed', String(!list));
    el('custom-view-list').setAttribute('aria-pressed', String(list));
    if (list) el('custom-map-detail').hidden = true;
    view.scrollIntoView({ block: 'end' });
    map?.invalidateSize();
  }
  el('custom-view-map').onclick = () => showView(false);
  el('custom-view-list').onclick = () => showView(true);
  const errorText = (dialog: HTMLDialogElement, message: string) => {
    const target = dialog.querySelector<HTMLElement>('[data-error]')!;
    target.textContent = message; target.hidden = !message;
  };
  async function call(body?: object, id?: string): Promise<CustomMap> {
    const response = await fetch(api + (id ? `&map=${encodeURIComponent(id)}` : ''), {
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) throw new MapRequestError(result.error ? t(result.error) : t('Map konnte nicht geladen oder gespeichert werden. Bitte erneut versuchen.'), response.status);
    if (!result.map || !isMapId(result.map.id) || !Array.isArray(result.map.entries)) throw new Error(t('Map konnte nicht geladen oder gespeichert werden. Bitte erneut versuchen.'));
    return result.map;
  }
  function failure(error: unknown) {
    return error instanceof Error && error.name === 'Error' ? error.message : t('Map konnte nicht geladen oder gespeichert werden. Bitte erneut versuchen.');
  }
  function remember(value: CustomMap) {
    saved = [{ id: value.id, name: value.name, automaticStatus: value.automatic?.status }, ...saved.filter(item => item.id !== value.id)].slice(0, 20);
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Sharing remains available. */ }
    mine.hidden = false;
    navigation.setMapLibrary(mine);
    updatePublicMaps([...publicMaps.filter(item => item.id !== value.id), ...publicMapSummaries([value])]);
  }
  function updatePublicMaps(maps: PublicMap[]) {
    publicMaps = maps.filter(item => isMapId(item.id) && item.venueCount >= PUBLIC_MAP_MIN_VENUES);
    navigation.setCustomMaps(publicMaps, id => { void load(id); });
  }
  function renderSavedMaps() {
    const section = create.querySelector<HTMLElement>('#saved-maps')!;
    section.hidden = !saved.length;
    const list = section.querySelector('div')!; list.replaceChildren();
    for (const item of saved) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = item.name + (item.automaticStatus && Object.hasOwn(automaticMapStatusLabels, item.automaticStatus) ? ` · ${t(automaticMapStatusLabels[item.automaticStatus])}` : '');
      button.onclick = () => void load(item.id);
      list.append(button);
    }
  }
  function showPicker() {
    navigation.close(); errorText(create, ''); renderSavedMaps(); create.showModal();
    if (saved.length) void fetch(`${api}&mapStatuses=${saved.map(item => item.id).join(',')}`, { signal: AbortSignal.timeout(10000) })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json();
        if (!Array.isArray(result.maps)) return;
        saved = saved.map(item => {
          const fresh = result.maps.find((map: { id: string }) => map.id === item.id);
          return fresh && typeof fresh.name === 'string' ? { id: item.id, name: fresh.name, automaticStatus: fresh.automaticStatus } : item;
        });
        try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Status remains available via the link. */ }
        if (create.open) renderSavedMaps();
      }).catch(() => { /* The last known status stays visible; opening a request retries. */ });
  }
  const mode = create.querySelector<HTMLSelectElement>('[name="mode"]')!;
  function updateCreateMode() {
    const automatic = mode.value === 'automatic';
    create.querySelectorAll<HTMLElement>('[data-manual]').forEach(element => { element.hidden = automatic; });
    const fields = create.querySelector<HTMLFieldSetElement>('[data-automatic]')!;
    fields.hidden = !automatic; fields.disabled = !automatic || busy;
    create.querySelector<HTMLElement>('[data-automatic-copy]')!.hidden = !automatic;
    create.querySelector<HTMLElement>('#create-map-title')!.textContent = automatic ? t('Automatische Map anfragen') : t('Eigene Map erstellen');
    create.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent = automatic ? t('Anfrage einreichen') : t('Map erstellen');
    create.querySelector<HTMLInputElement>('[name="name"]')!.placeholder = automatic ? t('z. B. Coop Aktionen Zürich') : t('z. B. Döner-Map');
  }
  mode.onchange = () => { createId = crypto.randomUUID(); errorText(create, ''); updateCreateMode(); };
  plus.onclick = mine.onclick = showPicker;
  for (const dialog of [create, entry]) {
    dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  }
  create.addEventListener('close', () => { if (view.hidden) plus.focus(); });
  function setBusy(value: boolean) {
    busy = value;
    for (const dialog of [create, entry]) {
      dialog.setAttribute('aria-busy', String(value));
      dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea').forEach(control => { control.disabled = value; });
    }
    updateCreateMode();
    if (value) closeVenueSuggestions();
    if (!value && lockedVenue) field('search').disabled = true;
  }
  create.querySelector('form')!.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const name = create.querySelector<HTMLInputElement>('[name="name"]')!.value;
    setBusy(true); errorText(create, '');
    try {
      const value = await call({ action: mode.value === 'automatic' ? 'requestAutomaticMap' : 'createMap', mapId: createId, name,
        ...(mode.value === 'automatic' ? { sourceUrl: create.querySelector<HTMLInputElement>('[name="sourceUrl"]')!.value,
          description: create.querySelector<HTMLTextAreaElement>('[name="description"]')!.value } : {}) });
      createId = crypto.randomUUID(); create.querySelector('form')!.reset(); updateCreateMode(); create.close(); open(value);
      el('custom-map-created').querySelector('[role=status]')!.textContent = t('Nur per Link erreichbar.');
      el('custom-map-created').hidden = Boolean(value.automatic);
    } catch (error) { errorText(create, failure(error)); }
    finally { setBusy(false); }
  };
  async function load(id: string) {
    const version = ++request;
    if (!create.open) showPicker();
    setBusy(true); errorText(create, '');
    try {
      const value = await call(undefined, id);
      if (version !== request) return;
      create.close(); open(value);
    } catch (error) { if (version === request) errorText(create, failure(error)); }
    finally { if (version === request) setBusy(false); }
  }
  function url(id: string) {
    const result = new URL(location.href); result.search = ''; result.hash = ''; result.searchParams.set('map', id);
    return result.href;
  }
  function updatePublicationControl(saving = false) {
    if (!current) return;
    if (current.automatic) { el('map-publish-control').hidden = true; el('map-publish-help').hidden = true; return; }
    const remaining = Math.max(0, PUBLIC_MAP_MIN_VENUES - mapVenueCount(current));
    const submitted = ['pending', 'approved'].includes(current.publication?.status || '');
    el('map-publish-control').hidden = submitted;
    el<HTMLButtonElement>('map-publish').disabled = saving || remaining > 0 || submitted;
    const help = el('map-publish-help');
    help.hidden = submitted || (!saving && remaining === 0);
    help.textContent = saving ? t('Wird gespeichert …') : remaining > 0
      ? t('Mindestens ein Ort mit Preis nötig.')
      : '';
  }
  function open(value: CustomMap) {
    current = value; remember(value);
    view.hidden = false; app.classList.add('custom-map-active');
    showView(false);
    history.replaceState(null, '', url(value.id));
    document.querySelectorAll<HTMLAnchorElement>('[data-locale]').forEach(link => {
      const target = new URL(link.href); target.search = `?map=${value.id}`; link.href = target.href;
    });
    document.getElementById('map-title')!.textContent = `${value.name} · ${t(cities[city].name)}`;
    document.title = `${value.name} | wobillig`;
    el('custom-map-name').textContent = value.name;
    el('custom-map-action-error').hidden = true;
    el('custom-map-share').hidden = true;
    el('custom-map-created').hidden = true;
    el('custom-map-detail').hidden = true;
    const automatic = value.automatic;
    el('custom-map-view-switch').hidden = Boolean(automatic);
    el('automatic-map-details').hidden = !automatic;
    view.querySelector<HTMLElement>('.custom-map-content')!.hidden = Boolean(automatic);
    el('map-add-entry').hidden = Boolean(automatic);
    if (automatic) {
      el('custom-map-visibility').hidden = false;
      el('map-publish-control').hidden = true; el('map-publish-help').hidden = true; el('map-withdraw').hidden = true;
      el('custom-map-summary').textContent = t(automaticMapStatusLabels[automatic.status]);
      el('custom-map-visibility').textContent = t('Anfrage nur per Link erreichbar. Es werden noch keine Angebote importiert.');
      el('automatic-map-details').innerHTML = `<h2>${e(t('Gewünschte Angebote'))}</h2><p>${e(automatic.description)}</p>
        <p><a href="${e(automatic.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(t('Vorgeschlagene Quelle ansehen'))}</a></p>
        <p>${e(t('Wir prüfen die Quelle und ob sich ihre Angebote zuverlässig übernehmen lassen. Die Anfrage startet noch keine automatische Map.'))}</p>
        ${automatic.note ? `<h3>${e(t('Rückmeldung vom Team'))}</h3><p>${e(automatic.note)}</p>` : ''}`;
      el('map-back').focus(); return;
    }
    if (!map) {
      map = L.map(el('custom-map-canvas')).setView(cities[city].center, 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer!.clearLayers();
    const entries = [...value.entries].sort((a, b) => a.priceChf - b.priceChf);
    const average = entries.length ? `CHF ${(entries.reduce((sum, item) => sum + item.priceChf, 0) / entries.length).toFixed(2)}` : '—';
    el('custom-map-summary').textContent = entries.length === 1 ? t('1 Lokal · Schnitt {price}', { price: average })
      : t('{count} Lokale · Schnitt {price}', { count: entries.length, price: average });
    const status = value.publication?.status;
    el('custom-map-visibility').hidden = !status;
    el('custom-map-visibility').textContent = status === 'approved' ? t('Öffentlich unter «Weitere» sichtbar.')
      : status === 'pending' ? t('Zur Prüfung eingereicht. Bis zur Freigabe bleibt die Map nur per Link erreichbar.')
      : status === 'rejected' ? t('Veröffentlichung abgelehnt. Du kannst die Map überarbeiten und erneut einreichen. Der Link bleibt nutzbar.')
      : '';
    updatePublicationControl();
    el('map-withdraw').hidden = status !== 'pending' && status !== 'approved';
    el('custom-map-entries').replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'empty';
      empty.textContent = t('Deine Map ist bereit. Füge das erste Lokal mit einem Preis hinzu.');
      el('custom-map-entries').append(empty);
    }
    for (const item of entries) {
      const marker = L.marker([item.venue.lat, item.venue.lon], {
        icon: L.divIcon({ className: 'custom-map-marker', html: e(item.priceChf.toFixed(2)), iconSize: [52, 28], iconAnchor: [26, 14] }),
        title: `${item.venue.name}: CHF ${item.priceChf.toFixed(2)}`,
      }).addTo(layer!);
      marker.on('click', () => showEntryDetail(item, marker.getElement()));
      const row = document.createElement('button'); row.type = 'button'; row.className = 'venue';
      row.innerHTML = `<span><strong>${e(item.venue.name)}</strong><small>${e(item.product)}</small><small>${e([item.venue.address, item.venue.postcode].filter(Boolean).join(', '))}</small><small>${e(t('Eingetragen'))} · ${e(new Date(item.updatedAt).toLocaleDateString(dateLocale()))}</small></span><span class="venue-price">CHF ${item.priceChf.toFixed(2)}</span>`;
      row.onclick = () => showEntryDetail(item, row);
      el('custom-map-entries').append(row);
    }
    requestAnimationFrame(() => {
      map!.invalidateSize();
      if (entries.length) map!.fitBounds(L.latLngBounds(entries.map(item => [item.venue.lat, item.venue.lon])), { padding: [35, 35], maxZoom: 16 });
      else map!.setView(cities[city].center, 13);
    });
    el('map-add-entry').focus();
  }
  function showEntryDetail(item: MapEntry, trigger?: HTMLElement) {
    const fromList = view.classList.contains('custom-map-show-list');
    showView(false);
    const detail = el('custom-map-detail');
    const venue = item.venue;
    detail.setAttribute('aria-label', venue.name);
    const offers = current!.entries.filter(entry => entry.venue.id === venue.id);
    const address = venue.address ? [venue.address, venue.postcode, t(cities[city].name)].filter(Boolean).join(' ')
      : t('Standort: {coordinates}', { coordinates: `${venue.lat.toFixed(5)}, ${venue.lon.toFixed(5)}` });
    detail.innerHTML = `<div class="detail-top"><strong>${e(venue.name)}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
      <p class="muted">${e(address)}</p>
      <div class="detail-actions"><button type="button" class="primary" data-add>${t('Preis hinzufügen')}</button><span class="detail-maps"><a href="${e(googleMapsLink(venue, cities[city].name))}" target="_blank" rel="noopener noreferrer" aria-label="${t('In Google Maps öffnen')}" translate="no">Google Maps</a></span></div>
      ${offers.map((offer, index) => `<div class="offer"><div class="offer-top"><strong>${e(offer.product)}</strong><strong class="nowrap">CHF ${offer.priceChf.toFixed(2)}</strong></div><div class="offer-meta"><span>${t('Eingetragen')} · ${e(new Date(offer.updatedAt).toLocaleDateString(dateLocale()))}</span><button type="button" data-edit="${index}">${t('Ändern')}</button></div></div>`).join('')}`;
    detail.hidden = false;
    const close = () => { detail.hidden = true; if (fromList) showView(true); trigger?.focus({ preventScroll: true }); };
    detail.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;
    detail.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    detail.querySelector<HTMLButtonElement>('[data-add]')!.onclick = () => { openEntry(); chooseVenue(venue); field('product').focus(); };
    detail.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button => {
      button.onclick = () => openEntry(offers[Number(button.dataset.edit)]);
    });
    map!.setView([venue.lat, venue.lon], 16);
    // Centre the marker in the part of the map that remains above/beside the detail sheet.
    const sheet = detail.getBoundingClientRect();
    map!.panBy(matchMedia('(max-width: 760px)').matches ? [0, sheet.height / 2] : [sheet.width / 2, 0], { animate: false });
    detail.focus({ preventScroll: true });
    view.scrollIntoView({ block: 'end' });
  }
  const venueSearch = field('search') as HTMLInputElement;
  const venueSuggestions = entry.querySelector<HTMLElement>('#map-venue-suggestions')!;
  const venueSearchHelp = entry.querySelector<HTMLElement>('#map-venue-search-help')!;
  let venueMatches: Bar[] = [], activeVenue = -1;
  let remoteMatches: Bar[] = [], placeSearchVersion = 0, placeSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let placeController: AbortController | undefined, placeStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  const placeResults = new Map<string, MapPlace>();
  function cancelPlaceSearch() {
    placeSearchVersion++; clearTimeout(placeSearchTimer); placeController?.abort();
  }
  function closeVenueSuggestions() {
    venueSuggestions.hidden = true;
    venueSearch.setAttribute('aria-expanded', 'false');
    venueSearch.removeAttribute('aria-activedescendant');
    activeVenue = -1;
  }
  function chooseVenue(venue: MapEntry['venue']) {
    cancelPlaceSearch();
    field('venue').value = venue.id;
    venueSearch.value = [venue.name, venue.address, venue.postcode].filter(Boolean).join(' · ');
    venueSearch.setCustomValidity('');
    editing = current?.entries.find(item => item.venue.id === venue.id);
    field('product').value = editing?.product || '';
    field('price').value = editing ? String(editing.priceChf) : '';
    venueSearchHelp.textContent = '';
    closeVenueSuggestions();
  }
  function showVenueSuggestions() {
    if (busy || lockedVenue || field('venue').value) return;
    // Rank the complete catalogue before limiting the visible suggestions.
    const matches = [...new Map([...searchSuggestions(venues(), venueSearch.value, 9), ...remoteMatches].map(venue => [venue.id, venue])).values()];
    venueMatches = matches.slice(0, 8); activeVenue = -1;
    venueSearch.removeAttribute('aria-activedescendant');
    venueSuggestions.replaceChildren();
    for (const [index, venue] of venueMatches.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1;
      button.id = `map-venue-option-${index}`; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false');
      button.innerHTML = `<strong>${e(venue.name)}</strong><small>${e([venue.address, venue.postcode].filter(Boolean).join(' · '))}</small>${placeResults.has(venue.id) ? '<small>OpenStreetMap</small>' : ''}`;
      button.onmousedown = event => event.preventDefault();
      button.onclick = () => { chooseVenue(venue); field('product').focus(); };
      venueSuggestions.append(button);
    }
    venueSuggestions.hidden = !venueMatches.length;
    venueSearch.setAttribute('aria-expanded', String(Boolean(venueMatches.length)));
    venueSearchHelp.textContent = placeStatus === 'loading' ? t('Weitere Orte werden in OpenStreetMap gesucht …')
      : placeStatus === 'error' ? t('OpenStreetMap-Suche gerade nicht verfügbar. Bitte erneut versuchen oder einen bekannten Ort wählen.')
      : !venueSearch.value.trim()
      ? t('Suche im gesamten Bestand nach Name, Adresse oder PLZ und wähle ein Lokal aus.')
      : !matches.length ? t('Kein Lokal gefunden. Suche nach einer anderen Adresse oder füge das Lokal neu hinzu.')
      : matches.length > 8 ? t('Weitere Treffer vorhanden. Verfeinere die Suche mit Name oder Adresse.')
      : t('Bitte ein Lokal aus den Vorschlägen auswählen.');
  }
  function schedulePlaceSearch() {
    cancelPlaceSearch(); remoteMatches = []; placeStatus = 'idle';
    const query = venueSearch.value.trim(), version = placeSearchVersion;
    if (query.length < 2) return;
    placeStatus = 'loading';
    placeSearchTimer = setTimeout(async () => {
      const controller = new AbortController(); placeController = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${api}&mapPlaces=${encodeURIComponent(query)}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.places)) throw new Error('Place search unavailable');
        if (version !== placeSearchVersion) return;
        remoteMatches = result.places.filter((place: MapPlace) => place?.venue?.id && typeof place.token === 'string').map((place: MapPlace) => {
          placeResults.set(place.venue.id, place); return place.venue;
        });
        placeStatus = 'ready';
      } catch {
        if (version !== placeSearchVersion) return;
        placeStatus = 'error';
      } finally {
        clearTimeout(timeout);
        if (version === placeSearchVersion && entry.open && document.activeElement === venueSearch) showVenueSuggestions();
      }
    }, 450);
  }
  function openEntry(item?: MapEntry) {
    if (!current) return;
    editing = item; lockedVenue = Boolean(item);
    cancelPlaceSearch(); remoteMatches = []; placeStatus = 'idle';
    entry.querySelector('form')!.reset(); errorText(entry, '');
    if (item) chooseVenue(item.venue);
    field('product').value = item?.product || '';
    field('price').value = item ? String(item.priceChf) : '';
    venueSearch.setCustomValidity(item ? '' : t('Bitte ein Lokal aus den Vorschlägen auswählen.'));
    closeVenueSuggestions();
    venueSearchHelp.textContent = item ? '' : t('Suche im gesamten Bestand nach Name, Adresse oder PLZ und wähle ein Lokal aus.');
    setBusy(false);
    entry.showModal();
  }
  venueSearch.oninput = () => {
    field('venue').value = ''; editing = undefined;
    venueSearch.setCustomValidity(t('Bitte ein Lokal aus den Vorschlägen auswählen.'));
    schedulePlaceSearch();
    showVenueSuggestions();
  };
  venueSearch.onfocus = showVenueSuggestions;
  venueSearch.onkeydown = event => {
    if (event.key === 'Escape' && !venueSuggestions.hidden) {
      event.preventDefault(); event.stopPropagation(); closeVenueSuggestions();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (venueSuggestions.hidden) showVenueSuggestions();
      if (!venueMatches.length || venueSuggestions.hidden) return;
      activeVenue = (activeVenue + (event.key === 'ArrowDown' ? 1 : activeVenue < 0 ? 0 : -1) + venueMatches.length) % venueMatches.length;
      [...venueSuggestions.children].forEach((button, index) => button.setAttribute('aria-selected', String(index === activeVenue)));
      const selected = venueSuggestions.children[activeVenue];
      venueSearch.setAttribute('aria-activedescendant', selected.id);
      selected.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !field('venue').value) {
      event.preventDefault();
      if (!venueSuggestions.hidden && venueMatches.length) {
        chooseVenue(venueMatches[Math.max(activeVenue, 0)]); field('product').focus();
      }
    }
  };
  venueSearch.onblur = event => {
    if (!(event.relatedTarget instanceof Node) || !venueSuggestions.contains(event.relatedTarget)) closeVenueSuggestions();
  };
  entry.addEventListener('close', () => { closeVenueSuggestions(); cancelPlaceSearch(); });
  const addVenue = venueForm(city, api, venues, bar => {
    added.push(bar); lockedVenue = false; venueSearch.disabled = false; chooseVenue(bar); field('product').focus();
  }, 'custom-');
  entry.querySelector<HTMLButtonElement>('#map-new-venue')!.onclick = () => addVenue(map?.getCenter() || L.latLng(cities[city].center));
  el('map-add-entry').onclick = () => openEntry();
  entry.querySelector('form')!.onsubmit = async event => {
    event.preventDefault(); if (busy || !current) return;
    const body = { action: 'saveMapEntry', mapId: current.id, barId: field('venue').value, product: field('product').value,
      priceChf: Number(field('price').value), revision: editing?.revision || 0, placeToken: placeResults.get(field('venue').value)?.token };
    setBusy(true); errorText(entry, '');
    try { const value = await call(body); entry.close(); open(value); }
    catch (error) {
      if (error instanceof MapRequestError && error.status === 409) {
        try { open(await call(undefined, current.id)); } catch { /* Keep the user's input available if refresh also fails. */ }
      }
      errorText(entry, failure(error));
    }
    finally { setBusy(false); }
  };
  el('custom-map-created').querySelector<HTMLButtonElement>('[data-dismiss]')!.onclick = () => {
    el('custom-map-created').hidden = true;
    el('map-back').focus();
    map?.invalidateSize();
  };
  el('custom-map-created').querySelector<HTMLButtonElement>('[data-copy]')!.onclick = async () => {
    if (!current) return;
    const href = url(current.id);
    const result = await shareLink({ url: href }, { clipboard: navigator.clipboard });
    if (result === 'copied') el('custom-map-created').querySelector('[role=status]')!.textContent = t('Link kopiert.');
    else {
      el('custom-map-share').hidden = false;
      const input = el('custom-map-share').querySelector('input')!;
      input.value = href; input.focus(); input.select();
    }
    map?.invalidateSize();
  };
  el('map-share').onclick = async () => {
    if (!current) return;
    const href = url(current.id);
    el('custom-map-share').hidden = false;
    const input = el('custom-map-share').querySelector('input')!;
    input.value = href;
    const result = await shareLink({ title: current.name, url: href });
    if (result === 'copied') el('custom-map-summary').textContent = t('Link kopiert.');
    else if (result === 'manual') { input.focus(); input.select(); }
  };
  async function publication(action: 'requestMapPublication' | 'withdrawMapPublication') {
    if (!current || busy) return;
    const id = current.id;
    busy = true; el('custom-map-action-error').hidden = true;
    const buttons = view.querySelectorAll<HTMLButtonElement>('.custom-map-toolbar button');
    buttons.forEach(button => { button.disabled = true; });
    updatePublicationControl(true);
    try { open(await call({ action, mapId: id })); }
    catch (error) {
      el('custom-map-action-error').textContent = failure(error); el('custom-map-action-error').hidden = false;
    } finally {
      busy = false; buttons.forEach(button => { button.disabled = false; });
      updatePublicationControl();
    }
  }
  el('map-publish').onclick = () => { void publication('requestMapPublication'); };
  el('map-withdraw').onclick = () => { void publication('withdrawMapPublication'); };
  el('map-back').onclick = () => {
    request++; current = undefined; view.hidden = true; app.classList.remove('custom-map-active');
    const target = new URL(location.href); target.searchParams.delete('map'); history.replaceState(null, '', target);
    onClose(); plus.focus();
  };
  return { get isOpen() { return !view.hidden; }, load, updatePublicMaps };
}
