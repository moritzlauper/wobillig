// Download the official district boundaries into
// public/data/<city>/districts.json (same shape as Zürich's file).
// Run from the repository root: npm run districts
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const UA = 'WobilligBot/1.0 (+https://github.com/moritzlauper/wobillig)';
const sources = {
  geneva: {
    url: 'https://vector.sitg.ge.ch/arcgis/rest/services/Hosted/VDG_QUARTIER_VILLE/FeatureServer/0/query?where=1%3D1&outFields=nom_quartier&outSR=4326&f=geojson',
    source: 'https://sitg.ge.ch/donnees/vdg-quartier-ville',
    license: 'SITG open data; attribution: Ville de Genève',
    // Stable local IDs keyed by names, independent of ArcGIS object IDs.
    feature: p => ({ number: ['Grottes Saint-Gervais', 'Acacias Bâtie', 'Plainpalais Jonction', 'Eaux-Vives Cité', 'Saint-Jean Charmilles', 'Champel', 'Servette Petit-Saconnex', 'Pâquis Sécheron'].indexOf(p.nom_quartier) + 1, name: p.nom_quartier }),
  },
  // Only the 19 Wohnviertel of the city; Riehen and Bettingen are outside the scraped area.
  basel: {
    url: 'https://data.bs.ch/api/explore/v2.1/catalog/datasets/100042/exports/geojson',
    source: 'https://data.bs.ch/explore/dataset/100042/',
    license: 'CC BY 4.0',
    feature: p => p.gemeinde_name === 'Basel' && { number: Number(p.wov_id), name: p.wov_name },
  },
  bern: {
    url: 'https://map.bern.ch/arcgis/rest/services/Geoportal/Stadtteile/MapServer/0/query?where=1%3D1&outFields=Nummer,Name&outSR=4326&f=geojson',
    source: 'https://opendata.swiss/de/dataset/stadtteile',
    license: 'Open use (opendata.swiss terms_open)',
    feature: p => ({ number: Number(p.Nummer), name: p.Name }),
  },
};

const round = value => Array.isArray(value) ? value.map(round) : Math.round(value * 1e6) / 1e6;
function bbox(coordinates) {
  const points = coordinates.flat(Infinity);
  const lons = points.filter((_, i) => i % 2 === 0), lats = points.filter((_, i) => i % 2 === 1);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

const selected = process.argv.slice(2);
for (const city of selected) if (!(city in sources) && city !== 'lausanne') throw new Error(`Unknown city: ${city}`);
for (const [city, config] of Object.entries(sources)) {
  if (selected.length && !selected.includes(city)) continue;
  const response = await fetch(config.url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`${city}: HTTP ${response.status}`);
  const features = (await response.json()).features.flatMap(feature => {
    const properties = config.feature(feature.properties);
    if (!properties) return [];
    const geometry = { type: feature.geometry.type, coordinates: round(feature.geometry.coordinates) };
    return [{ type: 'Feature', bbox: bbox(geometry.coordinates), properties, geometry }];
  }).sort((a, b) => a.properties.number - b.properties.number);
  const numbers = features.map(f => f.properties.number);
  if (!numbers.length || numbers.some((n, i) => n !== i + 1)) throw new Error(`${city}: unexpected district numbers ${numbers}`);
  const all = features.map(f => f.bbox);
  const collection = {
    type: 'FeatureCollection',
    bbox: [Math.min(...all.map(b => b[0])), Math.min(...all.map(b => b[1])), Math.max(...all.map(b => b[2])), Math.max(...all.map(b => b[3]))],
    features, source: config.source, license: config.license, retrievedAt: new Date().toISOString().slice(0, 10),
  };
  await mkdir(new URL(`../public/data/${city}/`, import.meta.url), { recursive: true });
  await writeFile(new URL(`../public/data/${city}/districts.json`, import.meta.url), JSON.stringify(collection));
  console.log(`${city}: ${features.length} districts`);
}
if (!selected.length || selected.includes('lausanne')) {
  execFileSync(process.env.PYTHON || (existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3'), ['-m', 'scraper.districts_lausanne'], { stdio: 'inherit' });
}
