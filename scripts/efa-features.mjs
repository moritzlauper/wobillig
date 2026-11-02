// Read-only feature extraction for scripts/efa.py. One observation per city + venue ID.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cocktailGroup, softdrinkGroups } from '../src/gastro-selection.ts';
import { pizzaGroup } from '../src/pizza-selection.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asOf = process.argv[2] || '2026-11-02';
const cities = ['zurich', 'bern', 'basel', 'winterthur', 'luzern', 'lausanne', 'geneva', 'olten'];
const categories = ['coffee', 'bars', 'pizza', 'gastro-softdrink', 'gastro-cocktail', 'burger', 'ramen', 'doner', 'falafel', 'brot', 'gastro-brot', 'glace', 'locations'];
const rows = new Map(), inventory = [], exclusions = [];
const normalize = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

function currentOffer(o) {
  if (!o.photoSource || o.confidence === 'community') return true;
  const date = o.photoSource.date || '';
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(date)) return false;
  const first = date.length === 7 ? `${date}-01` : date;
  const [y, m, d] = asOf.split('-').map(Number);
  const cutoff = new Date(Date.UTC(y, m - 7, 1));
  const last = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(d, last));
  return first >= cutoff.toISOString().slice(0, 10) && first <= asOf;
}

function reasons(o, category) {
  const flags = [], name = normalize(o.name), url = normalize(o.sourceUrl);
  if (!Number.isFinite(o.priceChf) || o.priceChf <= 0) flags.push('invalid_price');
  if (!currentOffer(o)) flags.push('expired_or_invalid_photo');
  if (/nahrwert|naehrwert|nutrition|allergen/.test(url)) flags.push('non_price_document');
  // A known foreign-menu path; no blanket exclusion of foreign domains/CDNs.
  if (/mallorca-es/.test(url)) flags.push('foreign_menu');
  if (category === 'coffee' && /cor[er]+tto|coretto|grappa|irish|baileys|whisk[ey]+|amaretto|cognac|kahlua/.test(name)) flags.push('alcoholic_coffee');
  return flags;
}

function add(row, key, offer, flags) {
  (row.rawOffers[key] ||= []).push(offer);
  if (!flags.length) (row.offers[key] ||= []).push(offer);
}

for (const city of cities) for (const category of categories) {
  const relative = `public/data/${city === 'zurich' ? '' : `${city}/`}${category}.json`;
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) continue;
  const bytes = fs.readFileSync(filename), data = JSON.parse(bytes);
  if (!Array.isArray(data.bars)) continue;
  inventory.push({ file: relative, city, category, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    generatedAt: data.generatedAt, venues: data.bars.length,
    pricedVenues: data.bars.filter(b => b.offers?.length || b.pizzaMenu?.length).length,
    offers: data.bars.reduce((n, b) => n + (b.offers?.length || 0) + (b.pizzaMenu?.length || 0), 0) });
  // Location catalogues can repeat offers from category datasets; never count them twice.
  if (category === 'locations') continue;
  for (const bar of data.bars) {
    const key = `${city}:${bar.id}`;
    if (!rows.has(key)) rows.set(key, { key, city, id: bar.id, name: bar.name, website: bar.website,
      type: bar.type, offers: {}, rawOffers: {} });
    const row = rows.get(key);
    for (const original of [...(bar.offers || []), ...(bar.pizzaMenu || [])]) {
      const flags = reasons(original, category);
      const offer = { name: original.name, price: original.priceChf, source: original.sourceUrl || '',
        observedAt: original.observedAt, confidence: original.confidence, evidence: original.evidence || '',
        volumeMl: original.volumeMl ?? null, sourceSha256: original.sourceSha256 || null };
      if (flags.length) exclusions.push({ key, venue: bar.name, category, flags, ...offer });
      if (category === 'coffee' && original.coffeeType) add(row, `coffee_${original.coffeeType}`, offer, flags);
      if (category === 'bars' && !original.alcoholFree) {
        const name = normalize(original.name);
        if (/panach|panash|radler|shandy|diesel|biermix|moretti limone/.test(name)) continue;
        // Strict observed serving type/size, no estimated type and no linear size conversion.
        if (original.beerType === 'draft' && [300, 500].includes(original.volumeMl)) add(row, `beer_draft_${original.volumeMl}`, offer, flags);
        if (original.beerType === 'bottle' && original.volumeMl === 330) add(row, 'beer_bottle_330', offer, flags);
      }
      if (category === 'pizza') {
        const group = original.pizzaType === 'margherita' ? 'margherita' : pizzaGroup(original);
        if (group) add(row, `pizza_${group}`, offer, flags);
      }
      if (category === 'gastro-cocktail') {
        const group = cocktailGroup(original.name);
        if (group && group !== 'mocktail') add(row, `cocktail_${group}`, offer, flags);
      }
      if (category === 'gastro-softdrink' && [300, 330].includes(original.volumeMl)) {
        for (const group of softdrinkGroups(original.name)) add(row, `softdrink_${group}`, offer, flags);
      }
    }
  }
}
process.stdout.write(JSON.stringify({ asOf, inventory, exclusions, rows: [...rows.values()] }));
