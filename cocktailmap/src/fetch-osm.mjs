// Lädt Bars und Kartengeometrie der Stadt Zürich aus OpenStreetMap (Overpass).
// Aufruf: node src/fetch-osm.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "raw");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "wobillig-cocktailmap/1.0";

const BARS_QUERY = `[out:json][timeout:120];
area["name"="Zürich"]["boundary"="administrative"]["admin_level"="8"]->.city;
nwr["amenity"="bar"](area.city);
out center tags;`;

const GEO_BBOX = "47.30,8.44,47.44,8.66";
const GEO_QUERY = `[out:json][timeout:120];
(
  way["natural"="water"]["name"="Zürichsee"](${GEO_BBOX});
  relation["natural"="water"]["name"="Zürichsee"](${GEO_BBOX});
  way["waterway"="river"]["name"="Limmat"](${GEO_BBOX});
  way["waterway"="river"]["name"="Sihl"](${GEO_BBOX});
  relation["boundary"="administrative"]["admin_level"="8"]["name"="Zürich"](${GEO_BBOX});
);
out geom;`;

async function overpass(query) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "User-Agent": USER_AGENT },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(150_000),
        });
        if (res.ok) return res.json();
        console.error(`${url}: HTTP ${res.status}`);
      } catch (error) {
        console.error(`${url}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
  }
  throw new Error("Overpass ist nicht erreichbar");
}

await mkdir(rawDir, { recursive: true });

const bars = await overpass(BARS_QUERY);
await writeFile(join(rawDir, "bars.json"), JSON.stringify(bars));

const geo = await overpass(GEO_QUERY);
await writeFile(join(rawDir, "geo.json"), JSON.stringify(geo));

console.log(`${bars.elements.length} Bars, ${geo.elements.length} Geometrie-Elemente`);
