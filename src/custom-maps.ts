import L from 'leaflet';
import { cities, type City } from './cities';
import { escapeHtml as e, type Bar } from './data';
import { isMapId, type CustomMap, type MapEntry } from './custom-map-data';
import { dateLocale, t } from './i18n';
import { shareLink } from './sharing';
import { venueForm } from './venue-form';

class MapRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function customMaps(city: City, known: () => Bar[], onClose: () => void) {
  const app = document.getElementById('app')!;
  const nav = document.getElementById('category-navigation')!;
  const api = `/api/prices?city=${city}`;
  const storageKey = `wobillig:maps:${city}`;
  let saved: { id: string; name: string }[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(value)) saved = value.filter(item => item && isMapId(item.id) && typeof item.name === 'string').slice(0, 20);
  } catch { /* Shared links work even without local storage. */ }
  let current: CustomMap | undefined, map: L.Map | undefined, layer: L.LayerGroup | undefined;
  let createId = crypto.randomUUID(), busy = false, request = 0;
  let editing: MapEntry | undefined;
  const added: Bar[] = [];
  const venues = () => [...new Map([...known(), ...added].map(bar => [bar.id, bar])).values()];
  const plus = document.createElement('button');
  plus.id = 'create-map'; plus.type = 'button'; plus.className = 'create-map-button';
  plus.setAttribute('aria-label', t('Map erstellen')); plus.title = t('Map erstellen');
  plus.innerHTML = '<span aria-hidden="true">+</span>';
  const mine = document.createElement('button');
  mine.id = 'my-maps'; mine.type = 'button'; mine.textContent = t('Meine Maps'); mine.hidden = !saved.length;
  nav.append(mine, plus);
  const create = document.createElement('dialog');
  create.id = 'create-map-dialog'; create.setAttribute('aria-labelledby', 'create-map-title');
  create.innerHTML = `<form class="custom-map-form">
    <div class="dialog-top"><strong id="create-map-title">${t('Eigene Map erstellen')}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
    <p>${t('Döner, Glace oder dein Lieblingsessen: Erstelle eine Map und sammle Lokale mit Preisen.')}</p>
    <label>${t('Name der Map')}<input name="name" required maxlength="60" placeholder="${t('z. B. Döner-Map')}" autocomplete="off"></label>
    <p class="muted">${e(t(cities[city].name))} · ${t('Alle mit dem Link können Preise ansehen und ergänzen.')}</p>
    <button class="primary" type="submit">${t('Map erstellen')}</button>
    <p role="alert" data-error hidden></p>
  </form><section id="saved-maps" hidden><h3>${t('Meine Maps')}</h3><div></div></section>`;
  const entry = document.createElement('dialog');
  entry.id = 'map-entry-dialog'; entry.setAttribute('aria-labelledby', 'map-entry-title');
  entry.innerHTML = `<form class="custom-map-form">
    <div class="dialog-top"><strong id="map-entry-title">${t('Lokal und Preis hinzufügen')}</strong><button type="button" data-close>${t('Schliessen')}</button></div>
    <label>${t('Lokal suchen')}<input name="search" type="search" placeholder="${t('Name oder Adresse')}" autocomplete="off"></label>
    <label>${t('Lokal')}<select name="venue" required></select></label>
    <button type="button" id="map-new-venue">${t('Lokal fehlt? Neu hinzufügen')}</button>
    <label>${t('Produkt / Portion')}<input name="product" required maxlength="100" placeholder="${t('z. B. Döner im Taschenbrot')}"></label>
    <label>${t('Preis pro Portion in CHF')}<input name="price" type="number" required min="0.5" max="500" step="0.01" inputmode="decimal"></label>
    <button class="primary" type="submit">${t('Speichern')}</button><p role="alert" data-error hidden></p>
  </form>`;
  document.body.append(create, entry);
  const view = document.createElement('section');
  view.id = 'custom-map-view'; view.hidden = true;
  view.innerHTML = `<div class="custom-map-toolbar">
    <button type="button" id="map-back">← ${t('Zurück')}</button>
    <strong id="custom-map-name"></strong>
    <button type="button" id="map-share">${t('Map teilen')}</button>
    <button type="button" class="primary" id="map-add-entry">+ ${t('Lokal und Preis hinzufügen')}</button>
    </div><p id="custom-map-summary" role="status"></p>
    <div id="custom-map-share" hidden><label>${t('Diesen Link kopieren und teilen:')}<input type="url" readonly></label></div>
    <div class="custom-map-content"><div id="custom-map-canvas" role="region" aria-label="${t('Eigene Map')}"></div><div id="custom-map-entries"></div></div>`;
  app.append(view);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => view.querySelector<T>('#' + id)!;
  const field = (name: string) => entry.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
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
    saved = [{ id: value.id, name: value.name }, ...saved.filter(item => item.id !== value.id)].slice(0, 20);
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Sharing remains available. */ }
    mine.hidden = false;
  }
  function showPicker() {
    errorText(create, '');
    const section = create.querySelector<HTMLElement>('#saved-maps')!;
    section.hidden = !saved.length;
    const list = section.querySelector('div')!; list.replaceChildren();
    for (const item of saved) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
      button.onclick = () => void load(item.id);
      list.append(button);
    }
    create.showModal();
  }
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
      dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(control => { control.disabled = value; });
    }
    if (!value && editing) { field('venue').disabled = true; field('search').disabled = true; }
  }
  create.querySelector('form')!.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const name = create.querySelector<HTMLInputElement>('[name="name"]')!.value;
    setBusy(true); errorText(create, '');
    try {
      const value = await call({ action: 'createMap', mapId: createId, name });
      createId = crypto.randomUUID(); create.querySelector('form')!.reset(); create.close(); open(value);
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
  function open(value: CustomMap) {
    current = value; remember(value);
    view.hidden = false; app.classList.add('custom-map-active');
    history.replaceState(null, '', url(value.id));
    document.querySelectorAll<HTMLAnchorElement>('[data-locale]').forEach(link => {
      const target = new URL(link.href); target.search = `?map=${value.id}`; link.href = target.href;
    });
    document.getElementById('map-title')!.textContent = `${value.name} · ${t(cities[city].name)}`;
    document.title = `${value.name} | wobillig`;
    el('custom-map-name').textContent = value.name;
    el('custom-map-share').hidden = true;
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
      const content = document.createElement('div');
      const label = document.createElement('p'); label.textContent = `${item.venue.name} · ${item.product} · CHF ${item.priceChf.toFixed(2)}`;
      const edit = document.createElement('button'); edit.textContent = t('Preis ändern'); edit.onclick = () => openEntry(item);
      content.append(label, edit); marker.bindPopup(content);
      const row = document.createElement('button'); row.type = 'button'; row.className = 'venue';
      row.innerHTML = `<span><strong>${e(item.venue.name)}</strong><small>${e(item.product)}</small><small>${e([item.venue.address, item.venue.postcode].filter(Boolean).join(', '))}</small><small>${e(t('Eingetragen'))} · ${e(new Date(item.updatedAt).toLocaleDateString(dateLocale()))}</small></span><span class="venue-price">CHF ${item.priceChf.toFixed(2)}</span>`;
      row.onclick = () => { map!.setView([item.venue.lat, item.venue.lon], 16); marker.openPopup(); el('custom-map-canvas').scrollIntoView({ block: 'nearest' }); };
      el('custom-map-entries').append(row);
    }
    requestAnimationFrame(() => {
      map!.invalidateSize();
      if (entries.length) map!.fitBounds(L.latLngBounds(entries.map(item => [item.venue.lat, item.venue.lon])), { padding: [35, 35], maxZoom: 16 });
      else map!.setView(cities[city].center, 13);
    });
    el('map-add-entry').focus();
  }
  function fillVenues(selected?: string) {
    const query = field('search').value.trim().toLocaleLowerCase();
    const list = venues().filter(bar => bar.id === selected || `${bar.name} ${bar.address} ${bar.postcode}`.toLocaleLowerCase().includes(query));
    const select = field('venue') as HTMLSelectElement;
    select.replaceChildren(new Option(t('Bitte Lokal wählen'), ''));
    const matches = list.slice(0, 80);
    const chosen = selected && list.find(bar => bar.id === selected);
    if (chosen && !matches.includes(chosen)) matches.unshift(chosen);
    for (const bar of matches) select.add(new Option(`${bar.name} · ${bar.address || bar.postcode}`, bar.id));
    if (selected) select.value = selected;
    else if (query && matches.length === 1) select.value = matches[0].id;
  }
  function openEntry(item?: MapEntry) {
    if (!current) return;
    editing = item;
    entry.querySelector('form')!.reset(); errorText(entry, '');
    field('product').value = item?.product || '';
    field('price').value = item ? String(item.priceChf) : '';
    fillVenues(item?.venue.id);
    setBusy(false);
    entry.showModal();
  }
  field('search').oninput = () => fillVenues();
  field('venue').onchange = () => {
    const previous = current?.entries.find(item => item.venue.id === field('venue').value);
    editing = previous;
    field('product').value = previous?.product || '';
    field('price').value = previous ? String(previous.priceChf) : '';
  };
  const addVenue = venueForm(city, api, venues, bar => {
    added.push(bar); field('search').value = ''; fillVenues(bar.id); field('venue').dispatchEvent(new Event('change')); field('product').focus();
  }, 'custom-');
  entry.querySelector<HTMLButtonElement>('#map-new-venue')!.onclick = () => addVenue(map?.getCenter() || L.latLng(cities[city].center));
  el('map-add-entry').onclick = () => openEntry();
  entry.querySelector('form')!.onsubmit = async event => {
    event.preventDefault(); if (busy || !current) return;
    const body = { action: 'saveMapEntry', mapId: current.id, barId: field('venue').value, product: field('product').value,
      priceChf: Number(field('price').value), revision: editing?.revision || 0 };
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
  el('map-back').onclick = () => {
    request++; current = undefined; view.hidden = true; app.classList.remove('custom-map-active');
    const target = new URL(location.href); target.searchParams.delete('map'); history.replaceState(null, '', target);
    onClose(); plus.focus();
  };
  return { get isOpen() { return !view.hidden; }, load };
}
