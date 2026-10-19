import { cities, type City } from './cities';
import { applyEntries, communityVenues, type Drink, type PriceEntry } from './community';
import { effectiveBeerType, isComparableOffer, isCurrentOffer, type Bar, type Dataset } from './data';

export function createExport(city: City, datasets: Partial<Record<Drink, Dataset>>, entries: PriceEntry[], communityLoaded: boolean, exportedAt = new Date().toISOString(), added: Bar[] = []) {
  const venues = communityVenues(datasets, entries, added);
  const merged = Object.fromEntries(Object.entries(datasets).map(([drink, dataset]) =>
    [drink, applyEntries(dataset, entries, venues, drink as Drink)])) as Partial<Record<Drink, Dataset>>;
  return {
    schemaVersion: 1,
    city,
    cityName: cities[city].name,
    exportedAt,
    currency: 'CHF',
    scope: 'All recorded offers in this city, without UI filters. Original portion prices; no normalization.',
    communityLoaded,
    missingCategories: (['beer', 'coffee', 'pizza'] as const).filter(drink => !datasets[drink]),
    locationAttribution: '© OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright',
    datasets: merged,
  };
}

// Quote every cell and neutralize spreadsheet formulas in externally sourced text.
function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCsv(snapshot: ReturnType<typeof createExport>): string {
  const headers = ['city', 'category', 'venue_id', 'venue_name', 'venue_type', 'address', 'postcode', 'latitude', 'longitude', 'website', 'opening_hours', 'outdoor', 'offer_name', 'coffee_type', 'pizza_type', 'price_chf', 'volume_ml', 'serving', 'beer_type', 'effective_beer_type', 'beer_type_estimated', 'beer_type_estimate_reason', 'alcohol_free', 'source_url', 'observed_at', 'confidence', 'evidence', 'current_offer', 'comparable_offer', 'photo_date', 'community_id', 'revision', 'venue_checked_at', 'dataset_generated_at', 'exported_at', 'community_loaded', 'missing_categories', 'attribution'];
  const rows: (string | number | boolean | null | undefined)[][] = [headers];
  for (const [category, dataset] of Object.entries(snapshot.datasets)) {
    for (const bar of dataset.bars) for (const offer of bar.offers) {
      const estimated = category === 'beer' && (!offer.beerType || offer.beerType === 'unknown') && Boolean(offer.beerTypeEstimate);
      rows.push([
        snapshot.cityName, category, bar.id, bar.name, bar.type, bar.address, bar.postcode, bar.lat, bar.lon,
        bar.website, bar.openingHours, bar.outdoor, offer.name, offer.coffeeType, offer.pizzaType,
        offer.priceChf, offer.volumeMl, offer.serving, offer.beerType,
        category === 'beer' ? effectiveBeerType(offer) : '', estimated, estimated ? offer.beerTypeEstimate?.reason : '',
        offer.alcoholFree, offer.sourceUrl, offer.observedAt, offer.confidence, offer.evidence,
        isCurrentOffer(offer), isComparableOffer(offer), offer.photoSource?.date, offer.communityId, offer.revision,
        bar.checkedAt, dataset.generatedAt, snapshot.exportedAt, snapshot.communityLoaded,
        snapshot.missingCategories.join('|'), dataset.attribution || snapshot.locationAttribution,
      ]);
    }
  }
  // UTF-8 BOM preserves umlauts in Excel; semicolons work with Swiss regional settings.
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function downloadExport(snapshot: ReturnType<typeof createExport>, format: 'csv' | 'json') {
  const content = format === 'csv' ? exportCsv(snapshot) : JSON.stringify(snapshot, null, 2) + '\n';
  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wobillig-${snapshot.city}-${snapshot.exportedAt.slice(0, 10)}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
