const cities = { zurich: 'Zürich', bern: 'Bern', basel: 'Basel' };
const drinks = { beer: 'Bier', coffee: 'Kaffee', pizza: 'Pizza' };
const coffeeLabels = { creme: 'Café crème / Kaffee', espresso: 'Espresso', double: 'Doppelter Espresso', ristretto: 'Ristretto',
  cappuccino: 'Cappuccino', latte: 'Latte macchiato', milk: 'Milchkaffee', flat_white: 'Flat White', americano: 'Americano', filter: 'Filterkaffee', matcha_latte: 'Matcha Latte' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = value => value == null ? '—' : Number(value).toFixed(2);
const action = row => !row.exact ? 'Altbestand' : !row.before ? 'Neuer Preis' : row.before.priceChf === row.after.priceChf ? 'Angaben geändert' : 'Preis geändert';
const portion = offer => [offer.volumeMl ? `${offer.volumeMl / 100} dl` : offer.serving === 'stange' ? 'Stange' : '',
  ({ draft: 'Offen', bottle: 'Flasche', can: 'Dose' })[offer.beerType] || '', coffeeLabels[offer.coffeeType] || offer.coffeeType || (offer.pizzaType ? 'Pizza Margherita' : ''),
  offer.alcoholFree && !offer.coffeeType && !offer.pizzaType ? 'alkoholfrei' : ''].filter(Boolean).join(' · ');

export function reviewRows(state, city, venues = []) {
  const changes = (state.priceChanges || []).filter(change => change.source !== 'menu-scan');
  const logged = new Set(changes.map(c => `${c.entryId}:${c.revision}`));
  const versions = [...state.history, ...state.entries];
  const byVersion = new Map(versions.map(e => [`${e.id}:${e.revision}`, e]));
  const byVenue = new Map([...venues, ...(state.venues || [])].map(v => [v.id, v]));
  const legacy = versions.filter(e => !e.offer.menuScan && !logged.has(`${e.id}:${e.revision}`)).map(entry => {
    const previous = byVersion.get(`${entry.id}:${entry.revision - 1}`);
    const venue = entry.venue || byVenue.get(entry.barId);
    return { id: `legacy:${entry.id}:${entry.revision}`, entryId: entry.id, revision: entry.revision,
      updatedAt: entry.updatedAt, barId: entry.barId, venueName: venue?.name || entry.barId,
      address: venue?.address || '', drink: entry.drink, targetKey: entry.targetKey, source: 'manual',
      before: previous?.offer || null, after: entry.offer, exact: false };
  });
  return [...changes.map(c => ({ ...c, exact: true })), ...legacy].map(row => ({ ...row, city }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision);
}

function csvCell(value) {
  let text = String(value ?? '');
  // Keep user-supplied names and sources from becoming spreadsheet formulas.
  if (typeof value !== 'number' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reviewCsv(rows) {
  const values = [['Zeit (UTC)', 'Stadt', 'Lokal', 'Adresse', 'Kategorie', 'Angebot vorher', 'Portion vorher', 'Angebot nachher', 'Portion nachher', 'CHF vorher', 'CHF nachher', 'Differenz CHF', 'Art', 'Revision', 'Quelle vorher', 'Quelle nachher', 'Beobachtet am', 'Protokoll', 'Eintrag-ID'],
    ...rows.map(r => [r.updatedAt, cities[r.city], r.venueName, r.address, drinks[r.drink], r.before?.name, r.before ? portion(r.before) : '', r.after.name, portion(r.after),
      r.before?.priceChf, r.after.priceChf, r.before ? Number((r.after.priceChf - r.before.priceChf).toFixed(2)) : '', action(r), r.revision,
      r.before?.sourceUrl, r.after.sourceUrl, r.after.observedAt, r.exact ? 'Vollständig' : 'Aus alten Versionen rekonstruiert; ursprünglicher Katalogpreis nicht erfasst', r.entryId])];
  return '\uFEFF' + values.map(row => row.map(csvCell).join(';')).join('\r\n');
}

function source(offer, label = 'Quelle öffnen') {
  if (!offer?.sourceUrl) return '';
  try {
    const url = new URL(offer.sourceUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  } catch { return ''; }
}

export function reviewHtml(rows, environment, generatedAt = new Date().toISOString(), online = false, maps = [], mapReviewsHtml = '') {
  const date = value => new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const automaticStatuses = { requested: 'Anfrage eingereicht', reviewing: 'Quelle wird geprüft', blocked: 'Quelle noch nicht verfügbar', rejected: 'Anfrage abgelehnt' };
  const mapStatuses = { pending: 'Zur Prüfung eingereicht', approved: 'Freigegeben', rejected: 'Abgelehnt' };
  const mapOverview = online ? `<section id="map-overview" aria-labelledby="maps-heading"><h2 id="maps-heading">Alle erstellten Maps</h2>
    <p>${maps.length} Maps in allen Städten · Neueste zuerst · Diese Übersicht ist nur mit dem Prüfzugang sichtbar.</p>
    <div class="table-wrap"><table><thead><tr><th>Map</th><th>Stadt</th><th>Einträge</th><th>Status</th><th>Erstellt</th></tr></thead><tbody>${[...maps]
      .sort((a, b) => b.map.createdAt.localeCompare(a.map.createdAt) || a.map.name.localeCompare(b.map.name, 'de-CH'))
      .map(({ city, map }) => `<tr><td><a href="${city === 'zurich' ? '/' : '/' + city}?map=${encodeURIComponent(map.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(map.name)}</a></td>
        <td>${escapeHtml(cities[city])}</td><td>${map.entries.length}</td><td>${map.automatic ? automaticStatuses[map.automatic.status] || 'Automatische Map' : mapStatuses[map.publication?.status] || 'Nur per Link'}</td><td class="nowrap">${date(map.createdAt)}</td></tr>`).join('')}</tbody></table>
    ${maps.length ? '' : '<p>Noch keine Maps erstellt.</p>'}</div></section>` : '';
  const body = rows.map(r => {
    const kind = action(r);
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date(r.updatedAt));
    return `<tr data-city="${escapeHtml(r.city)}" data-drink="${escapeHtml(r.drink)}" data-action="${kind}" data-day="${day}">
      <td class="nowrap">${date(r.updatedAt)}<small>${escapeHtml(cities[r.city])}</small></td>
      <td><strong>${escapeHtml(r.venueName)}</strong><small>${escapeHtml(r.address)}</small><small>${escapeHtml(drinks[r.drink])}</small></td>
      <td><strong>${escapeHtml(r.after.name)}</strong><small>${escapeHtml(portion(r.after))}</small>
      <details><summary>Details · Version ${r.revision}</summary><p>${escapeHtml(r.entryId)}</p>
      <strong>Vorher</strong><pre>${escapeHtml(r.before ? JSON.stringify(r.before, null, 2) : r.exact ? 'Kein bisheriges Angebot.' : 'Nicht historisch erfasst.')}</pre>${source(r.before)}
      <p><strong>Nachher</strong></p><pre>${escapeHtml(JSON.stringify(r.after, null, 2))}</pre>${source(r.after)}</details></td>
      <td class="number">${r.before ? money(r.before.priceChf) : r.exact ? '—' : 'Unbekannt'}<small>${source(r.before, 'Quelle vorher') || 'Keine Quelle erfasst'}</small></td>
      <td class="number"><strong>${money(r.after.priceChf)}</strong><small>${source(r.after, 'Quelle nachher') || 'Keine Quelle erfasst'}</small></td>
      <td class="number">${r.before ? `${r.after.priceChf > r.before.priceChf ? '+' : ''}${money(r.after.priceChf - r.before.priceChf)}` : '—'}</td>
      <td><span class="tag">${kind}</span>${!r.exact ? '<small>Rekonstruiert: gespeicherte Vorversion; damalige Anzeige nicht vollständig erfasst.</small>' : ''}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Wobillig · ${online ? 'Prüfübersicht' : 'Manuelle Preisänderungen'}</title>
  <style>#map-review article{margin:20px 0;padding:20px;background:white;border:1px solid #d8e1d9;border-radius:12px}#map-review h2{overflow-wrap:anywhere}#map-review .scroll{overflow:auto}#map-review form{display:flex;gap:12px;flex-wrap:wrap}*{box-sizing:border-box}body{margin:0;background:#f4f5f1;color:#173329;font:15px system-ui,sans-serif}main{max-width:1480px;margin:auto;padding:36px 24px}h1{font-size:30px;margin:8px 0}p{line-height:1.6}.muted,small{color:#52675e}small{display:block;margin-top:6px}.stats{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.stat{background:white;border:1px solid #d8e1d9;border-radius:12px;padding:18px 24px;min-width:180px}.stat strong{display:block;font-size:28px}.filters{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:24px 0}label{font-size:13px;font-weight:600}input,select,button,a.download{display:block;font:inherit;border:1px solid #a9bdb0;border-radius:7px;padding:10px;background:white;color:#173329;margin-top:6px}button,a.download{cursor:pointer;background:#173329;color:white;text-decoration:none}.table-wrap{overflow:auto;border:1px solid #d8e1d9;border-radius:12px;background:white}table{border-collapse:collapse;width:100%;text-align:left}th{background:#eaf0e9;font-size:12px;text-transform:uppercase;letter-spacing:.04em}th,td{padding:16px;border-bottom:1px solid #e3e9e2;vertical-align:top}td{min-width:110px}.number{text-align:right;font-variant-numeric:tabular-nums}.nowrap{white-space:nowrap}a{color:#176b4d}summary{cursor:pointer;margin-top:12px;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:440px;font-size:12px}.tag{display:inline-block;background:#edf3e8;border-radius:5px;padding:5px 8px;font-size:12px;white-space:nowrap}#empty{padding:24px;text-align:center}[hidden]{display:none!important}@media(max-width:600px){main{padding:20px 12px}h1{font-size:24px}.stat{flex:1;min-width:130px;padding:14px}.filters label{flex:1 1 150px;min-width:150px}input,select{width:100%}}.automatic-map-request{border:1px solid #ccd8ce;border-radius:8px;padding:18px;margin:16px 0;overflow-wrap:anywhere}.automatic-map-request form{display:grid;gap:12px}.automatic-map-request label{display:grid;gap:6px}.automatic-map-request input,.automatic-map-request select{width:100%;min-width:0}.automatic-map-request button{justify-self:start}</style></head>
  <body><main><div class="muted">WOBILLIG · PRÜFÜBERSICHT · ${escapeHtml(environment === 'production' ? 'Produktion' : 'Entwicklung / Vorschau')}</div>${online ? '<nav aria-label="Prüfbereiche"><a href="#map-overview">Alle Maps</a> · <a href="#map-review">Maps zur Freigabe</a> · <a href="#automatic-map-review">Automatische Maps</a> · <a href="#deal-pilot">Aktionspilot</a> · <a href="#price-review">Preisänderungen</a></nav>' : ''}<h1>${online ? 'Prüfübersicht' : 'Manuelle Preisänderungen'}</h1>
  <p class="muted">Stand: ${date(generatedAt)} · Schweizer Zeit · Neueste Änderungen zuerst.<br>${online ? 'Aktueller Stand beim Öffnen. <a href="/output/price-review/production">Jetzt aktualisieren</a>' : `Aktualisieren mit <code>npm run prices:review${environment === 'production' ? '' : ' -- --development'}</code>, danach diese Datei neu laden.`}</p>
  ${mapOverview}
  ${online ? `<section id="map-review" aria-labelledby="map-review-heading"><h2 id="map-review-heading">Maps zur Freigabe</h2>${mapReviewsHtml || '<p>Keine offenen Einreichungen.</p>'}</section><h2 id="price-review">Manuelle Preisänderungen</h2>` : ''}
  <div class="stats"><div class="stat"><strong>${rows.length}</strong>manuelle Einträge / Änderungen</div><div class="stat"><strong>${rows.filter(r => r.exact && r.before && r.before.priceChf !== r.after.priceChf).length}</strong>vollständig erfasste Preisänderungen</div><div class="stat"><strong>${new Set(rows.map(r => r.city + ':' + r.barId)).size}</strong>betroffene Lokale</div></div>
  <p>Jede Zeile dokumentiert eine Speicherung von Hand. Foto-Scans erscheinen erst bei einer manuellen Korrektur. «Angaben geändert» umfasst auch erneutes Speichern mit gleichem Preis. Altbestand ist aus gespeicherten Versionen rekonstruiert; fehlende ursprüngliche Preise werden als unbekannt angezeigt.</p>
  <div class="filters"><label>Lokal / Angebot<input id="search" type="search" placeholder="Suchen …"></label>
  <label>Stadt<select id="city"><option value="">Alle Städte</option>${Object.entries(cities).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
  <label>Kategorie<select id="drink"><option value="">Alle Kategorien</option>${Object.entries(drinks).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
  <label>Art<select id="action"><option value="">Alle Änderungen</option>${['Preis geändert', 'Neuer Preis', 'Angaben geändert', 'Altbestand'].map(s => `<option>${s}</option>`).join('')}</select></label>
  <label>Ab Datum<input id="since" type="date"></label><button id="reset">Filter zurücksetzen</button><a class="download" href="${online ? '/output/price-review/production?format=csv' : 'price-changes.csv'}" download>CSV · alle Einträge</a></div>
  <p id="count" role="status">${rows.length} Einträge</p><div id="price-changes" class="table-wrap"><table><thead><tr><th>Zeit / Stadt</th><th>Lokal</th><th>Angebot</th><th class="number">Vorher CHF</th><th class="number">Nachher CHF</th><th class="number">Differenz</th><th>Art</th></tr></thead><tbody>${body}</tbody></table><p id="empty" ${rows.length ? 'hidden' : ''}>Keine manuellen Änderungen für diese Auswahl.</p></div>
  </main><script>const controls=['search','city','drink','action','since'].map(id=>document.getElementById(id));const rows=[...document.querySelectorAll('#price-changes tbody tr')];function filter(){const [query,city,drink,action,since]=controls.map(el=>el.value.trim().toLocaleLowerCase('de-CH'));let count=0;for(const row of rows){row.hidden=!!((query&&!row.textContent.toLocaleLowerCase('de-CH').includes(query))||(city&&row.dataset.city!==city)||(drink&&row.dataset.drink!==drink)||(action&&row.dataset.action.toLocaleLowerCase('de-CH')!==action)||(since&&row.dataset.day<since));if(!row.hidden)count++;}document.getElementById('count').textContent=count+' von '+rows.length+' Einträgen';document.getElementById('empty').hidden=count>0;}controls.forEach(el=>el.addEventListener('input',filter));document.getElementById('reset').addEventListener('click',()=>{controls.forEach(el=>el.value='');filter();});</script></body></html>`;
}
