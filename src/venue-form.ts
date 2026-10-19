import L from 'leaflet';
import { cities, type City } from './cities';
import { searchAddresses } from './address-search';
import { type Bar } from './data';
import { duplicateVenue, newVenueTypes, validateVenue } from './venue-contributions';
import { t } from './i18n';

export function venueForm(cityId: City, api: string, known: () => Bar[], saved: (bar: Bar, created: boolean) => void) {
  const city = cities[cityId];
  const dialog = document.createElement('dialog');
  dialog.id = 'venue-dialog'; dialog.setAttribute('aria-labelledby', 'venue-title');
  dialog.innerHTML = `<form id="venue-form">
    <div class="dialog-top"><strong id="venue-title" tabindex="-1">${t('Lokal hinzufügen')}</strong><button id="venue-close" type="button">${t('Schliessen')}</button></div>
    <p>${t('Fehlt ein Lokal in {city}? Trage es hier ein. Es wird für alle sichtbar; Preise kannst du anschliessend ergänzen.', { city: t(city.name) })}</p>
    <fieldset id="venue-fields">
      <label>Name<input id="venue-name" maxlength="100" autocomplete="organization" required></label>
      <label>${t('Art des Lokals')}<select id="venue-type">${Object.entries(newVenueTypes).map(([key, label]) => `<option value="${key}">${t(label)}</option>`).join('')}</select></label>
      <label>${t('Strasse und Hausnummer')}<input id="venue-address" maxlength="160" autocomplete="street-address" placeholder="${t('z. B. Bümplizstrasse 97a')}" required></label>
      <label>${t('Postleitzahl')}<input id="venue-postcode" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="postal-code" required></label>
      <button id="venue-search" type="button">${t('Adresse auf Karte suchen')}</button>
      <p id="venue-search-status" role="status"></p><div id="venue-addresses"></div>
      <p id="venue-map-help">${t('Wähle eine Adresse oder tippe auf die Karte. Den Punkt kannst du zum Eingang verschieben.')}</p>
      <div id="venue-map" role="region" aria-label="${t('Position des neuen Lokals')}" aria-describedby="venue-map-help"></div>
      <button id="venue-center" type="button">${t('Kartenmitte übernehmen')}</button><p id="venue-position" role="status">${t('Noch keine Position gewählt.')}</p>
      <label>Website (optional)<input id="venue-website" type="url" maxlength="1500" placeholder="https://…"></label>
      <label class="check"><input id="venue-outdoor" type="checkbox"> ${t('Draussen sitzen')}</label>
      <div id="venue-duplicates" role="status"></div>
      <button id="venue-save" type="submit" class="primary">${t('Lokal speichern')}</button>
    </fieldset><p id="venue-error" role="alert" tabindex="-1" hidden></p>
  </form>`;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>('#' + id)!;
  const value = (id: string) => el<HTMLInputElement>(id).value;
  let map: L.Map | undefined, marker: L.Marker | undefined, point: L.LatLng | undefined;
  let busy = false, request = 0, controller: AbortController | undefined;
  function place(latlng: L.LatLng) {
    point = latlng;
    if (!marker) {
      marker = L.marker(latlng, { draggable: true, title: t('Position des neuen Lokals'),
        icon: L.divIcon({ className: 'new-venue-marker', html: '<span aria-hidden="true">+</span>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map!);
      marker.on('dragend', () => place(marker!.getLatLng()));
    } else marker.setLatLng(latlng);
    el('venue-position').textContent = t('Position gewählt. Bitte prüfe den Punkt auf der Karte.');
    duplicates();
  }
  function duplicates() {
    const name = value('venue-name').trim().toLocaleLowerCase('de-CH');
    const matches = known().filter(b => name.length >= 3 && (b.name.toLocaleLowerCase('de-CH').includes(name) || name.includes(b.name.toLocaleLowerCase('de-CH')))).slice(0, 4);
    el('venue-duplicates').replaceChildren();
    if (!matches.length) return;
    const title = document.createElement('p'); title.textContent = t('Ist dein Lokal bereits dabei?'); el('venue-duplicates').append(title);
    for (const bar of matches) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = [bar.name, bar.address].filter(Boolean).join(' · ');
      button.onclick = () => { dialog.close(); saved(bar, false); };
      el('venue-duplicates').append(button);
    }
  }
  el('venue-name').oninput = duplicates;
  function cancelSearch() { request++; controller?.abort(); el<HTMLButtonElement>('venue-search').disabled = false; }
  for (const id of ['venue-address', 'venue-postcode']) el(id).oninput = () => {
    cancelSearch(); point = undefined; marker?.remove(); marker = undefined;
    el('venue-position').textContent = t('Adresse geändert. Bitte die Kartenposition erneut wählen.');
    el('venue-addresses').replaceChildren(); el('venue-search-status').textContent = '';
  };
  el('venue-search').onclick = async () => {
    cancelSearch(); const current = request; const searchController = new AbortController(); controller = searchController;
    const timeout = setTimeout(() => searchController.abort(), 15000);
    el<HTMLButtonElement>('venue-search').disabled = true;
    el('venue-search-status').textContent = t('Adresse wird gesucht …'); el('venue-addresses').replaceChildren();
    try {
      if (!value('venue-address').trim()) throw new Error('Bitte zuerst die Strasse und Hausnummer eingeben.');
      const results = (await searchAddresses(`${value('venue-address')} ${value('venue-postcode')} ${city.name}`, city.center, searchController.signal)).filter(r => r.origin === 'address');
      if (current !== request || !dialog.open) return;
      el('venue-search-status').textContent = results.length ? t('Bitte die passende Adresse auswählen:') : t('Keine Adresse gefunden. Du kannst die Position direkt auf der Karte wählen.');
      for (const result of results) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = result.label;
        button.onclick = () => {
          const parts = result.label.match(/^(.+?)\s+(\d{4})\s/);
          if (parts) { el<HTMLInputElement>('venue-address').value = parts[1]; el<HTMLInputElement>('venue-postcode').value = parts[2]; }
          place(L.latLng(result.lat, result.lon)); map!.setView(point!, 18);
          el('venue-search-status').textContent = result.label; el('venue-addresses').replaceChildren();
        };
        el('venue-addresses').append(button);
      }
    } catch (error) {
      if (current === request) el('venue-search-status').textContent = error instanceof Error && error.message.startsWith('Bitte') ? t(error.message) : t('Adresssuche gerade nicht verfügbar. Wähle die Position direkt auf der Karte.');
    } finally { clearTimeout(timeout); if (current === request) el<HTMLButtonElement>('venue-search').disabled = false; }
  };
  el('venue-center').onclick = () => place(map!.getCenter());
  el('venue-close').onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', cancelSearch);
  el<HTMLFormElement>('venue-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    el('venue-error').hidden = true;
    try {
      const input = validateVenue({ name: value('venue-name'), type: value('venue-type'), address: value('venue-address'), postcode: value('venue-postcode'),
        lat: point?.lat, lon: point?.lng, website: value('venue-website'), outdoor: el<HTMLInputElement>('venue-outdoor').checked }, cityId);
      const duplicate = duplicateVenue(input, known());
      if (duplicate) { dialog.close(); saved(duplicate, false); return; }
      cancelSearch(); busy = true; marker?.dragging?.disable();
      el<HTMLFieldSetElement>('venue-fields').disabled = true; el<HTMLButtonElement>('venue-close').disabled = true;
      el('venue-save').textContent = t('Speichern …');
      const response = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addVenue', venue: input }), signal: AbortSignal.timeout(30000) });
      const result = await response.json().catch(() => { throw new Error(t('Speichern gerade nicht möglich. Bitte erneut versuchen.')); });
      if (!response.ok || !result.venue) throw new Error(result.error || t('Das Lokal konnte nicht gespeichert werden.'));
      dialog.close(); saved(result.venue, result.created);
    } catch (error) {
      el('venue-error').textContent = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
        ? t(error.message) : t('Verbindung unterbrochen. Bitte erneut versuchen; derselbe Eintrag wird nicht doppelt angelegt.');
      el('venue-error').hidden = false;
      el('venue-error').focus();
    } finally {
      busy = false; marker?.dragging?.enable(); el<HTMLFieldSetElement>('venue-fields').disabled = false;
      el<HTMLButtonElement>('venue-close').disabled = false; el('venue-save').textContent = t('Lokal speichern');
    }
  };
  return (center: L.LatLng, name = '') => {
    el<HTMLFormElement>('venue-form').reset(); point = undefined; marker?.remove(); marker = undefined;
    el<HTMLInputElement>('venue-name').value = name; el('venue-error').hidden = true;
    el('venue-position').textContent = t('Noch keine Position gewählt.'); el('venue-search-status').textContent = ''; el('venue-addresses').replaceChildren();
    dialog.showModal();
    if (!map) {
      map = L.map(el('venue-map'), { scrollWheelZoom: false }).setView(center, 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      map.on('click', event => { if (!busy) place(event.latlng); });
    }
    map.invalidateSize(); map.setView(center, 16); duplicates(); el('venue-title').focus();
  };
}
