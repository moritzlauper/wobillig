import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import {
  bestOffer,
  matchingOffers,
  coffeeLabels,
  portion,
  cost,
  distance,
  escapeHtml as e,
  filterBars,
  safeUrl,
  type Bar,
  type Dataset,
  type Filters,
} from "./data";
const icon = (name: string) =>
  ({ search: "⌕", arrow: "↗", location: "◎", close: "×", beer: "▥" })[name] ||
  name;
const venueLabel = (type: string) =>
  ({bar: "Bar", pub: "Pub", biergarten: "Biergarten", restaurant: "Restaurant", cafe: "Café"})[type] || "Location";
const money = (v: number) => v.toFixed(2);
const date = (s: string) =>
  new Intl.DateTimeFormat("de-CH").format(new Date(s));
type Drink = "beer" | "coffee";
const initialDrink: Drink = new URLSearchParams(location.search).get("drink") === "coffee" ? "coffee" : "beer";
const f: Filters = {
  drink: initialDrink,
  coffeeType: "creme",
  query: "",
  max: 15,
  volume: "500",
  type: "",
  unknown: true,
  outdoor: false,
  alcoholFree: false,
  mode: "half",
  sort: "price",
};
const datasets: Partial<Record<Drink, Dataset>> = {};
const isCoffee = () => f.drink === "coffee";
const cheapLimit = () => isCoffee() ? 4.5 : 6;
const offerUnit = (o: import("./data").Offer) => o.coffeeType ? "Getränk" : f.mode === "half" ? `5 dl${o.volumeMl === 500 ? "" : "*"}` : portion(o);
let data: Dataset | undefined,
  position: [number, number] | undefined,
  selected: string | undefined;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<header><a class="brand" href="./" aria-label="wogünstig Startseite"><span class="brandmark">w.</span>wogünstig</a><span class="city"><span></span>ZÜRICH EDITION</span><button class="about-button" id="about">Die Idee <span>↗</span></button></header>
<main><aside class="sidebar"><section class="intro"><div class="drink-switch" role="group" aria-label="Getränk auswählen"><button id="drink-beer" aria-pressed="true">Bier</button><button id="drink-coffee" aria-pressed="false">Kaffee</button></div><div class="eyebrow">WENIGER ZAHLEN. MEHR ZÜRICH.</div><h1><span id="drink-title" class="plain-title">Gutes Bier.</span><br>Guter <span>Preis.</span><svg viewBox="0 0 100 40" aria-hidden="true"><path d="M3 30 Q40 2 88 20 M72 5 L91 20 L72 35"/></svg></h1><p id="intro-copy">Dein nächstes Lieblingsbier ist gleich um die Ecke.<br>Finde heraus, wo Zürich günstig anstösst.</p></section>
<div class="search"><span aria-hidden="true">${icon("search")}</span><input id="search" type="search" placeholder="Bar, Strasse oder Postleitzahl" aria-label="Locations durchsuchen"><kbd>⌘ K</kbd></div>
<section class="filters" aria-label="Filter"><div class="filter-heading"><span id="filter-title">DEIN BIER. DEINE REGELN.</span><button id="reset">Zurücksetzen</button></div><div class="price-label"><label for="price">Max. Bierpreis</label><strong id="price-value">CHF 15.00</strong></div><input id="price" type="range" min="3" max="15" step="0.5" value="15"><div class="range-labels"><span>CHF 3</span><span>CHF 15</span></div><div class="select-row"><label id="volume-label">Grösse<select id="volume"><option value="all">Alle Grössen</option><option value="300">3 dl</option><option value="330">3.3 dl</option><option value="400">4 dl</option><option value="500" selected>5 dl (Fass & Flasche)</option></select></label><label id="coffee-label" hidden>Kaffeesorte<select id="coffeeType"><option value="all">Alle Sorten</option>${Object.entries(coffeeLabels).map(([key,label]) => `<option value="${key}">${label}</option>`).join("")}</select></label><label>Location<select id="type"><option value="">Alle Locations</option><option value="bar">Bar</option><option value="pub">Pub</option><option value="biergarten">Biergarten</option><option value="restaurant">Restaurant</option><option value="cafe">Café</option></select></label></div><div class="chips"><button id="outdoor" aria-pressed="false">☀ Draussen sitzen</button><button id="alcohol-free" aria-pressed="false">Alkoholfrei</button></div><label class="check"><input id="unknown" type="checkbox" checked>Auch Locations ohne passenden Preis</label><p id="coffee-note" class="filter-note" hidden>Preis pro Getränk. Wähle eine Sorte, um gleiche Kaffees zu vergleichen. „Kaffee“ und Café crème sind zusammengefasst.</p><label id="normalize-label" class="check"><input id="normalize" type="checkbox" checked>Fair vergleichen: Preis pro 5 dl</label></section>
<div id="coverage-strip" class="coverage-strip"></div><div class="results-top"><span><strong id="count">…</strong> <span id="count-label">Spots entdeckt</span></span><select id="sort" aria-label="Sortierung"><option value="price">Günstigste zuerst</option><option value="name">Name A–Z</option><option value="distance">In deiner Nähe</option></select></div><div id="results" aria-live="polite"><div class="empty">Zürich wird geladen …</div></div><footer><span id="footer-copy">Mit Liebe zu Zürich. Und zum Feierabend.</span><br><button id="data-info">Daten & Transparenz ↗</button></footer></aside>
<section class="map-panel" aria-label="Karte der Locations in Zürich"><div id="map"></div><div class="map-caption"><span class="live-dot"></span><strong>Zürich, Schweiz</strong><span class="caption-sub">Ein guter Abend beginnt hier.</span></div><div class="map-actions"><button id="locate" aria-label="Meinen Standort verwenden" title="Meinen Standort verwenden">◎</button><button id="fit" aria-label="Alle Treffer auf Karte anzeigen" title="Alle Treffer anzeigen">⤢</button></div><div class="map-legend"><strong id="map-unit">CHF / 5 dl · berechnet</strong><span><i class="lime"></i><span id="legend-cheap">bis CHF 6</span></span><span><i class="dark"></i><span id="legend-expensive">über CHF 6</span></span><span><i class="grey"></i>Preis offen</span></div><div id="detail" hidden></div><div class="map-bottom"><span>DEIN FEIERABEND, DEIN VIERTEL.</span><strong>Prost, Züri. ↗</strong></div></section></main><button id="mobile-view">Karte anzeigen ↗</button><div id="toast" role="status"></div>
<dialog id="info"><button id="close-info" class="close" aria-label="Schliessen">×</button><div class="eyebrow">TRANSPARENT BIS ZUM LETZTEN SCHLUCK</div><h2>Gute Daten.<br>Mehr Zürich.</h2><p>wogünstig macht öffentlich auffindbare Bier- und Kaffeepreise vergleichbar. Die Karte umfasst OSM-Bars und Pubs sowie Restaurants und Cafés mit gefundenen Getränkepreisen. Kaffee wird pro Getränk und nach Sorte verglichen. Die Kaffeeansicht enthält Locations mit gefundenen Kaffeepreisen; fehlende Sorten können optional als „Preis offen“ angezeigt werden. Eine zusätzliche Suche prüft Gastronomie-Websites innerhalb der Stadtgrenze und erweitert den Datenbestand laufend.</p><p>Automatisch erkannte Preise sind Hinweise, keine Preisgarantie. Quelle, Portionsgrösse und Prüfdatum stehen bei jedem Angebot. Preise können sich ändern. Beim Bier ist ein Preis pro 5 dl ein rechnerischer Vergleich, kein bestellbares Angebot. Kaffee wird nie auf eine erfundene Tassengrösse umgerechnet.</p><p>Nicht jede Bar ist in OpenStreetMap eingetragen. Nicht jede Getränkekarte ist online lesbar. Fehlende Preise werden deshalb offen angezeigt. Öffnungszeiten aus OSM werden unverändert angegeben; wir behaupten keinen Live-Öffnungsstatus.</p><div id="coverage"></div><p class="attribution">Standorte: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap-Mitwirkende · ODbL</a>. Basiskarte: © OpenStreetMap. Preisangaben: verlinkte Originalquellen.</p></dialog>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const map = L.map("map", { zoomControl: false }).setView([47.378, 8.535], 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);
L.control.zoom({ position: "bottomright" }).addTo(map);
new ResizeObserver(() => map.invalidateSize()).observe(
  document.getElementById("map")!,
);
const layer = L.layerGroup().addTo(map);
let current: Bar[] = [];
let userMarker: L.CircleMarker | undefined;
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 4500);
}
function offerLabel(b: Bar) {
  const o = bestOffer(b, f);
  return o ? `${money(cost(o, f.mode))}` : "–";
}
function render() {
  if (!data) return;
  current = filterBars(data.bars, f, position);
  $("count").textContent = String(current.length);
  $("price-value").textContent = `CHF ${money(f.max)}`;
  $("count-label").textContent = `Locations · ${current.filter((b) => bestOffer(b, f)).length} mit passendem Preis`;
  $("coverage-strip").textContent =
    `${data.bars.reduce((n, b) => n + b.offers.length, 0)} ${isCoffee() ? "Kaffeeangebote" : "Bierangebote"} bei ${data.bars.filter((b) => b.offers.length).length} von ${data.bars.length} Locations · vor deinen Filtern`;
  document.querySelector("label[for=price]")!.textContent =
    isCoffee() ? "Max. Preis pro Getränk" : f.mode === "half" ? "Max. Preis pro 5 dl" : "Max. Bierpreis";
  $("map-unit").textContent =
    isCoffee() ? `CHF / Getränk · ${f.coffeeType === "all" ? "alle Sorten" : coffeeLabels[f.coffeeType!]}` : f.mode === "half" ? `CHF / 5 dl${f.volume === "500" ? "" : " · berechnet"}` : "CHF / Glas";
  layer.clearLayers();
  $("results").innerHTML = current.length
    ? current
        .map((b, i) => {
          const o = bestOffer(b, f);
          return `<button class="bar-card ${selected === b.id ? "selected" : ""}" data-id="${e(b.id)}"><span class="bar-number">${String(i + 1).padStart(2, "0")}</span><span class="bar-content"><strong>${e(b.name)}</strong><span>${e(b.address || b.postcode || "Zürich")} ${position ? ` · ${distance(position, [b.lat, b.lon]).toFixed(1)} km` : ""}</span><span class="bar-tags">${e(venueLabel(b.type))}${b.outdoor ? " · Terrasse" : ""}${o ? ` · ${portion(o)}${f.mode === "half" && o.volumeMl !== 500 ? " · auf 5 dl gerechnet" : ""}` : " · Noch kein passender Preis"}</span></span><span class="bar-price ${o && cost(o, f.mode) <= cheapLimit() ? "cheap" : ""}">${o ? `<small>CHF / ${offerUnit(o)}</small>${offerLabel(b)}` : '<span class="unknown-price">Preis offen</span>'}<span class="card-arrow">↗</span></span></button>`;
        })
        .join("")
    : `<div class="empty"><span>◌</span><h3>Hier ist noch Durststrecke.</h3><p>Erhöhe dein Budget oder lockere die Filter.</p><button id="empty-reset">Filter zurücksetzen</button></div>`;
  for (const b of current) {
    const o = bestOffer(b, f),
      cheap = o && cost(o, f.mode) <= cheapLimit();
    const marker = L.marker([b.lat, b.lon], {
      icon: L.divIcon({
        className: "marker-wrapper",
        html: `<span class="price-marker ${o ? (cheap ? "cheap" : "known") : "unknown"} ${selected === b.id ? "active" : ""}">${o ? `${offerLabel(b)}<small>/ ${offerUnit(o)}</small>` : "•"}</span>`,
        iconSize: o ? [62, 40] : [22, 22],
        iconAnchor: o ? [31, 20] : [11, 11],
      }),
      title: `${b.name}: ${o ? `CHF ${offerLabel(b)} pro ${offerUnit(o)}${o.coffeeType ? ` (${portion(o)})` : ""}` : "Preis offen"}`,
      keyboard: true,
      zIndexOffset: selected === b.id ? 2000 : o ? 1000 : 0,
    }).on("click", () => showBar(b));
    layer.addLayer(marker);
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-id]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          showBar(data!.bars.find((b) => b.id === el.dataset.id)!)),
    );
  $("empty-reset")?.addEventListener("click", reset);
  if (selected) {
    const b = current.find((b) => b.id === selected);
    if (b) detail(b);
    else {
      $("detail").hidden = true;
      selected = undefined;
    }
  }
}
function detail(b: Bar) {
  const offers = matchingOffers(b, f);
  $("detail").innerHTML =
    `<button class="close" id="close-detail" aria-label="Details schliessen">×</button><div class="eyebrow">${e(venueLabel(b.type).toUpperCase())} ${b.outdoor ? " · MIT TERRASSE" : ""}</div><h2>${e(b.name)}</h2><p>${e(b.address || "Adresse in OpenStreetMap ergänzen")} ${e(b.postcode)}</p>${f.mode === "half" && offers.some((o) => o.volumeMl !== 500) ? `<p class="comparison-note">*Auf 5 dl umgerechnet. Bestellbare Portion und tatsächlicher Preis stehen bei jedem Bier.</p>` : ""}${offers.length ? offers.map((o) => `<div class="offer"><div><strong>${e(o.name)}</strong><span>${portion(o)} · ${o.confidence === "reviewed" ? "Manuell geprüft" : "Automatisch erkannt"}</span></div><div class="offer-price"><strong>CHF ${money(o.priceChf)}</strong><span>${o.coffeeType ? "pro Getränk" : `für ${portion(o)}`}</span>${f.mode === "half" && o.volumeMl !== 500 ? `<small>CHF ${money(cost(o, "half"))} / 5 dl*</small>` : ""}</div></div><div class="source-line"><a target="_blank" rel="noopener noreferrer" href="${safeUrl(o.sourceUrl)}">Originalkarte ↗</a><span>Gelesen ${date(o.observedAt)}</span></div>`).join("") : `<div class="no-price">Noch kein passender ${isCoffee() ? "Kaffeepreis" : "Bierpreis"}.<br><span>${b.scrapeStatus === "no_website" ? "Keine Website in OpenStreetMap hinterlegt." : "Die Karte konnte noch keinen passenden Preis liefern."}</span></div>`}${b.openingHours ? `<p class="hours">Öffnungszeiten laut OSM<br><strong>${e(b.openingHours)}</strong></p>` : ""}<div class="detail-links">${safeUrl(b.website) ? `<a href="${safeUrl(b.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ""}<a href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking" target="_blank" rel="noopener noreferrer">Route planen ↗</a><a href="https://www.openstreetmap.org/${e(b.id)}" target="_blank" rel="noopener noreferrer">OSM ↗</a></div>`;
  $("detail").hidden = false;
  $("close-detail").onclick = () => {
    selected = undefined;
    $("detail").hidden = true;
    render();
  };
}
function showBar(b: Bar) {
  selected = b.id;
  document.body.classList.add("show-map");
  $("mobile-view").textContent = "Liste anzeigen ↙";
  map.invalidateSize();
  map.flyTo([b.lat, b.lon], 16, { duration: 0.6 });
  render();
  detail(b);
}
function reset() {
  Object.assign(f, {
    query: "",
    max: isCoffee() ? 12 : 15,
    volume: isCoffee() ? "all" : "500",
    coffeeType: "creme",
    type: "",
    unknown: true,
    outdoor: false,
    alcoholFree: false,
    mode: isCoffee() ? "glass" : "half",
    sort: "price",
  });
  $<HTMLInputElement>("search").value = "";
  $<HTMLInputElement>("price").value = String(f.max);
  $<HTMLSelectElement>("volume").value = f.volume;
  $<HTMLSelectElement>("coffeeType").value = f.coffeeType!;
  $<HTMLSelectElement>("type").value = "";
  $<HTMLSelectElement>("sort").value = "price";
  $<HTMLInputElement>("unknown").checked = true;
  $<HTMLInputElement>("normalize").checked = !isCoffee();
  for (const id of ["outdoor", "alcohol-free"])
    $(id).setAttribute("aria-pressed", "false");
  render();
}
$("reset").onclick = reset;
$("search").oninput = () => {
  f.query = $<HTMLInputElement>("search").value;
  render();
};
$("price").oninput = () => {
  f.max = Number($<HTMLInputElement>("price").value);
  render();
};
for (const key of ["volume", "coffeeType", "type", "sort"] as const)
  $(key).onchange = () => {
    f[key] = $<HTMLSelectElement>(key).value;
    if (key === "sort" && f.sort === "distance" && !position) {
      toast("Standort freigeben, um nach Nähe zu sortieren.");
      locate();
    }
    render();
  };
$("unknown").onchange = () => {
  f.unknown = $<HTMLInputElement>("unknown").checked;
  render();
};
$("normalize").onchange = () => {
  f.mode = $<HTMLInputElement>("normalize").checked ? "half" : "glass";
  render();
};
for (const [id, key] of [
  ["outdoor", "outdoor"],
  ["alcohol-free", "alcoholFree"],
] as const)
  $(id).onclick = () => {
    f[key] = !f[key];
    $(id).setAttribute("aria-pressed", String(f[key]));
    render();
  };
function locate() {
  if (!navigator.geolocation) {
    toast("Dieser Browser unterstützt keinen Standort.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      position = [p.coords.latitude, p.coords.longitude];
      userMarker?.remove();
      userMarker = L.circleMarker(position, {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#3e6ae1",
        fillOpacity: 1,
      }).addTo(map);
      map.setView(position, 15);
      render();
    },
    () => {
      toast("Standort nicht verfügbar. Du kannst weiter auf der Karte suchen.");
      if (f.sort === "distance") {
        f.sort = "price";
        $<HTMLSelectElement>("sort").value = "price";
        render();
      }
    },
    { timeout: 10000 },
  );
}
$("locate").onclick = locate;
$("fit").onclick = () => {
  if (current.length)
    map.fitBounds(L.latLngBounds(current.map((b) => [b.lat, b.lon])), {
      padding: [45, 60],
      maxZoom: 15,
    });
  else toast("Keine Treffer für diese Filter.");
};
for (const id of ["about", "data-info"])
  $(id).onclick = () => $<HTMLDialogElement>("info").showModal();
$("close-info").onclick = () => $<HTMLDialogElement>("info").close();
$("mobile-view").onclick = () => {
  const shown = document.body.classList.toggle("show-map");
  $("mobile-view").textContent = shown
    ? "Liste anzeigen ↙"
    : "Karte anzeigen ↗";
  map.invalidateSize();
};
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "k") {
    event.preventDefault();
    $("search").focus();
  }
});
function setDrink(drink: Drink) {
  f.drink = drink;
  data = datasets[drink];
  selected = undefined;
  $("detail").hidden = true;
  document.body.classList.toggle("coffee-mode", isCoffee());
  for (const value of ["beer", "coffee"])
    $(`drink-${value}`).setAttribute("aria-pressed", String(drink === value));
  $("drink-title").textContent = isCoffee() ? "Guter Kaffee." : "Gutes Bier.";
  $("intro-copy").innerHTML = isCoffee()
    ? "Deine nächste Kaffeepause ist gleich um die Ecke.<br>Finde deinen Lieblingskaffee zum guten Preis."
    : "Dein nächstes Lieblingsbier ist gleich um die Ecke.<br>Finde heraus, wo Zürich günstig anstösst.";
  $("filter-title").textContent = isCoffee() ? "DEIN KAFFEE. DEINE PAUSE." : "DEIN BIER. DEINE REGELN.";
  $<HTMLInputElement>("search").placeholder = "Location, Strasse oder Postleitzahl";
  for (const id of ["volume-label", "normalize-label", "alcohol-free"]) $(id).hidden = isCoffee();
  for (const id of ["coffee-label", "coffee-note"]) $(id).hidden = !isCoffee();
  $<HTMLInputElement>("price").min = isCoffee() ? "2" : "3";
  $<HTMLInputElement>("price").max = isCoffee() ? "12" : "15";
  document.querySelector(".range-labels")!.innerHTML = `<span>CHF ${isCoffee() ? 2 : 3}</span><span>CHF ${isCoffee() ? 12 : 15}</span>`;
  $("legend-cheap").textContent = `bis CHF ${money(cheapLimit())}`;
  $("legend-expensive").textContent = `über CHF ${money(cheapLimit())}`;
  document.querySelector(".caption-sub")!.textContent = isCoffee() ? "Eine gute Pause beginnt hier." : "Ein guter Abend beginnt hier.";
  document.querySelector(".map-bottom > span")!.textContent = isCoffee() ? "DEINE PAUSE, DEIN VIERTEL." : "DEIN FEIERABEND, DEIN VIERTEL.";
  document.querySelector(".map-bottom > strong")!.textContent = isCoffee() ? "Hoi, Kafi. ↗" : "Prost, Züri. ↗";
  $("footer-copy").textContent = isCoffee() ? "Mit Liebe zu Zürich. Und zur Kaffeepause." : "Mit Liebe zu Zürich. Und zum Feierabend.";
  const url = new URL(location.href);
  if (isCoffee()) url.searchParams.set("drink", "coffee");
  else url.searchParams.delete("drink");
  history.replaceState(null, "", url);
  reset();
  if (data) {
    $("coverage").innerHTML = `<strong>${data.bars.length} Locations · ${data.bars.filter((b) => b.offers.length).length} mit ${isCoffee() ? "Kaffee" : "Bier"}preisen</strong><p>Standorte abgerufen: ${date(data.discoveredAt)}<br>Daten aktualisiert: ${date(data.generatedAt)}</p>`;
  } else {
    layer.clearLayers();
    current = [];
    $("count").textContent = "0";
    $("coverage-strip").textContent = "";
    $("coverage").textContent = "Daten nicht verfügbar.";
    $("results").innerHTML = '<div class="empty"><h3>Die Daten machen kurz Pause.</h3><p>Bitte lade die Seite erneut.</p><button onclick="location.reload()">Erneut versuchen</button></div>';
  }
}
for (const drink of ["beer", "coffee"] as const)
  $(`drink-${drink}`).onclick = () => setDrink(drink);
Promise.allSettled((["beer", "coffee"] as const).map(async (drink) => {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${drink === "beer" ? "bars" : "coffee"}.json`);
  if (!r.ok) throw Error("Datenabruf fehlgeschlagen");
  datasets[drink] = await r.json();
})).then(() => setDrink(f.drink || initialDrink));
