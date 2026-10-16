"""Fill missing venue addresses from OSM contact tags or unambiguous buildings.

WOBILLIG_CITY=bern python -m scraper.addresses [--osm-file path/to/osm.json]
No nearest-neighbour guessing: a venue must be inside a building with exactly
one street/house-number address. Run after discovery to update every category.
"""
import argparse
import json
from pathlib import Path
import re


def tag_address(tags):
    street = tags.get('addr:street') or tags.get('addr:place') or tags.get('contact:street', '')
    number = tags.get('addr:housenumber') or tags.get('contact:housenumber', '')
    postcode = tags.get('addr:postcode') or tags.get('contact:postcode', '')
    if street:
        return {'address': ' '.join(filter(None, [street, number])), 'postcode': postcode}
    for key in ('addr:full', 'contact:addr', 'contact:addr:full'):
        full = tags.get(key, '').strip()
        match = re.fullmatch(r'(.+?)\s*,?\s+(\d{4})\s+[^,]+(?:,\s*(?:Schweiz|Switzerland|CH))?', full)
        if match:
            return {'address': match[1].rstrip(', '), 'postcode': postcode or match[2]}
    return {'address': '', 'postcode': postcode}


def contains(ring, lon, lat):
    """Ray casting, including points on the boundary (OSM entrance nodes)."""
    inside = False
    for a, b in zip(ring, ring[1:]):
        x1, y1, x2, y2 = a['lon'], a['lat'], b['lon'], b['lat']
        if min(x1, x2) <= lon <= max(x1, x2) and min(y1, y2) <= lat <= max(y1, y2):
            if abs((lon - x1) * (y2 - y1) - (lat - y1) * (x2 - x1)) < 1e-14:
                return True
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


class AddressLookup:
    def __init__(self, elements):
        self.elements = {f"{e['type']}/{e['id']}": e for e in elements}
        self.nodes = [e for e in elements if e['type'] == 'node' and tag_address(e.get('tags', {}))['address']]
        self.buildings = []
        self.cache = {}
        for e in elements:
            ring = e.get('geometry', [])
            if e['type'] != 'way' or not e.get('tags', {}).get('building') or len(ring) < 4 or ring[0] != ring[-1]:
                continue
            bounds = (min(p['lon'] for p in ring), min(p['lat'] for p in ring),
                      max(p['lon'] for p in ring), max(p['lat'] for p in ring))
            self.buildings.append((e, bounds))

    def building_addresses(self, building, bounds):
        if building['id'] not in self.cache:
            left, bottom, right, top = bounds
            # Other businesses can reveal conflicting entrances, but their
            # address alone is not evidence for the venue we are resolving.
            candidates = [building] + [n for n in self.nodes
                if left <= n['lon'] <= right and bottom <= n['lat'] <= top
                and contains(building['geometry'], n['lon'], n['lat'])]
            self.cache[building['id']] = [
                {**tag_address(e.get('tags', {})), 'addressSource': f"https://www.openstreetmap.org/{e['type']}/{e['id']}",
                 'usable': e is building or not any(k in e.get('tags', {}) for k in ('amenity', 'shop', 'office', 'tourism'))}
                for e in candidates if tag_address(e.get('tags', {}))['address']]
        return self.cache[building['id']]

    def lookup(self, venue):
        direct = tag_address(self.elements.get(venue['id'], {}).get('tags', {}))
        if direct['address']:
            return {**direct, 'addressSource': f"https://www.openstreetmap.org/{venue['id']}"}
        candidates = []
        for building, bounds in self.buildings:
            left, bottom, right, top = bounds
            if left <= venue['lon'] <= right and bottom <= venue['lat'] <= top and contains(building['geometry'], venue['lon'], venue['lat']):
                candidates.extend(self.building_addresses(building, bounds))
        usable = [c for c in candidates if c['usable']]
        if usable and len({c['address'] for c in candidates}) == 1 and len({c['postcode'] for c in candidates if c['postcode']}) <= 1:
            return {k: v for k, v in max(usable, key=lambda c: bool(c['postcode'])).items() if k != 'usable'}
        return None


def has_street(address):
    # The old importer sometimes stored just a house number (e.g. "10").
    return bool(re.search(r'[^\W\d_]{2}', address or ''))


def enrich(datasets, lookup, reviewed=None):
    known = {}
    for dataset in datasets:
        for venue in dataset['bars']:
            if has_street(venue.get('address')):
                known.setdefault(venue['id'], {k: venue[k] for k in ('address', 'postcode', 'addressSource') if k in venue})
    changed = set()
    for dataset in datasets:
        for venue in dataset['bars']:
            if has_street(venue.get('address')):
                continue
            address = (reviewed or {}).get(venue['id']) or known.get(venue['id']) or lookup.lookup(venue)
            if address:
                venue.update(address)
                known[venue['id']] = address
                changed.add(venue['id'])
    return changed


def main():
    import requests
    from scraper.cities import AREA, DATA_DIR
    from scraper.scrape_coffee import save
    from scraper.scrape import UA
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--osm-file', type=Path)
    args = parser.parse_args()
    if args.osm_file:
        raw = json.loads(args.osm_file.read_text())
    else:
        query = '[out:json][timeout:90];' + AREA + '(nwr["addr:street"](area.city);nwr["addr:place"](area.city);way["building"](area.city);nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|biergarten)$"](area.city););out geom;'
        response = requests.get('https://overpass.osm.ch/api/interpreter', params={'data': query}, headers={'User-Agent': UA}, timeout=120)
        response.raise_for_status()
        raw = response.json()
    if raw.get('remark') or not raw.get('elements'):
        raise ValueError('Incomplete OSM response; existing addresses were not changed')
    paths = [DATA_DIR / f'{name}.json' for name in ('bars', 'coffee', 'pizza', 'locations') if (DATA_DIR / f'{name}.json').exists()]
    datasets = [json.loads(p.read_text()) for p in paths]
    reviewed = json.loads(Path(__file__).with_name('reviewed_addresses.json').read_text())
    changed = enrich(datasets, AddressLookup(raw['elements']), reviewed)
    for path, dataset in zip(paths, datasets):
        save(path, dataset)
    print(f'Added addresses for {len(changed)} venues')


if __name__ == '__main__':
    main()
