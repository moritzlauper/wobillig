// Baut site/data.json aus den Rohdaten in raw/ und den Rezepten aus src/cocktails.mjs.
// Aufruf: node src/build.mjs (nach fetch-osm.mjs und scan-menus.mjs)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COCKTAILS } from "./cocktails.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "raw");
const siteDir = join(root, "site");

// Gramm reiner Alkohol pro Milliliter bei 20 °C.
const ALCOHOL_DENSITY = 0.789;
// Schweizer Standardgetränk: 10 g reiner Alkohol.
const STANDARD_DRINK_GRAMS = 10;

const round = (value, digits) => Number(value.toFixed(digits));
const readJson = async (name) => JSON.parse(await readFile(join(rawDir, name), "utf8"));

function cocktailFacts(cocktail) {
  const volume = cocktail.ingredients.reduce((sum, item) => sum + item.ml, 0);
  const alcoholMl = cocktail.ingredients.reduce((sum, item) => sum + (item.ml * item.abv) / 100, 0);
  const grams = alcoholMl * ALCOHOL_DENSITY;
  return {
    volume,
    abv: round((alcoholMl / volume) * 100, 1),
    grams: round(grams, 1),
    standardDrinks: round(grams / STANDARD_DRINK_GRAMS, 1),
  };
}

function address(tags) {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  if (!street) return null;
  const place = [tags["addr:postcode"], tags["addr:city"] || "Zürich"].filter(Boolean).join(" ");
  return `${street}, ${place}`;
}

function barRecord(element, menus) {
  const key = `${element.type}/${element.id}`;
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const tags = element.tags;
  const menu = menus[key] ?? { status: "keine_website", matches: [] };
  return {
    id: key,
    name: tags.name,
    lat: round(lat, 6),
    lon: round(lon, 6),
    address: address(tags),
    opening: tags.opening_hours ?? null,
    website: menu.website ?? null,
    phone: tags.phone ?? tags["contact:phone"] ?? null,
    outdoorSeating: tags.outdoor_seating === "yes",
    wheelchair: tags.wheelchair ?? null,
    menuStatus: menu.status,
    menu: menu.matches.map((match) => ({ cocktail: match.cocktail, url: match.url })),
  };
}

function lineFrom(geometry) {
  return geometry.map((point) => [round(point.lat, 4), round(point.lon, 4)]);
}

function geoRecords(geo) {
  const lakes = [];
  const rivers = [];
  const boundary = [];
  for (const element of geo.elements) {
    const name = element.tags?.name;
    if (element.type === "way") {
      if (!element.geometry) continue;
      if (element.tags.natural === "water") lakes.push(lineFrom(element.geometry));
      else if (element.tags.waterway === "river") rivers.push({ name, line: lineFrom(element.geometry) });
    }
    if (element.type === "relation") {
      for (const member of element.members) {
        if (!member.geometry || member.role !== "outer") continue;
        if (element.tags.natural === "water") lakes.push(lineFrom(member.geometry));
        else boundary.push(lineFrom(member.geometry));
      }
    }
  }
  return { lakes, rivers, boundary };
}

await mkdir(siteDir, { recursive: true });

const barsRaw = await readJson("bars.json");
const geo = await readJson("geo.json");
const menus = await readJson("menus.json");

const bars = barsRaw.elements
  .filter((element) => element.tags?.name)
  .map((element) => barRecord(element, menus))
  .sort((a, b) => a.name.localeCompare(b.name, "de"));

const cocktails = COCKTAILS.map(({ aliases, ...cocktail }) => ({ ...cocktail, ...cocktailFacts(cocktail) }));

const statusCounts = Object.values(menus).reduce((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});

const data = {
  generatedAt: new Date().toISOString(),
  osmTimestamp: barsRaw.osm3s?.timestamp_osm_base ?? null,
  menuScan: {
    scannedAt: Object.values(menus).map((item) => item.scannedAt).sort().at(-1) ?? null,
    statusCounts,
  },
  geo: geoRecords(geo),
  cocktails,
  bars,
};

await writeFile(join(siteDir, "data.json"), JSON.stringify(data));
console.log(`${bars.length} Bars, ${cocktails.length} Cocktails, ${data.geo.lakes.length} Seeflächen, ${data.geo.rivers.length} Flüsse`);
