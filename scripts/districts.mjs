// Download the official district boundaries of Basel and Bern into
// public/data/<city>/districts.json (same shape as Zürich's file).
// Run from the repository root: npm run districts
import { writeFile } from 'node:fs/promises';

const UA = 'WobilligBot/1.0 (+https://github.com/moritzlauper/wobillig)';
const sources = {
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

for (const [city, config] of Object.entries(sources)) {
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
  await writeFile(new URL(`../public/data/${city}/districts.json`, import.meta.url), JSON.stringify(collection));
  console.log(`${city}: ${features.length} districts`);
}
