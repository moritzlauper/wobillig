"""Publish named OSM food/drink venues for map-based community contributions.

python -m scraper.locations
python -m scraper.locations --venues-file scraper/cache/pizza-venues.json
No menu fetching or invented prices; locations stay outside price comparisons
until a price is contributed. Failed discovery leaves the previous file intact.
"""
import argparse
import json
from pathlib import Path
from scraper.scrape import ROOT, discover
from scraper.scrape_coffee import save

QUERY = '[out:json][timeout:90];area["name"="Zürich"]["admin_level"="8"]->.city;nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|biergarten)$"]["name"](area.city);out center tags;'


def catalogue(discovered, existing):
    # Keep the IDs and metadata already used by the price datasets.
    bars = {b['id']: {**b, 'offers': [], 'scrapeStatus': 'location_only', 'checkedAt': None}
            for b in discovered['bars'] + existing}
    return {**discovered, 'bars': sorted(bars.values(), key=lambda b: (b['name'].casefold(), b['id']))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venues-file', type=Path, help='Reuse a previously discovered, normalized OSM dataset')
    args = parser.parse_args()
    found = json.loads(args.venues_file.read_text()) if args.venues_file else discover({}, query=QUERY)
    if not found.get('bars'):
        raise ValueError('Refusing to publish an empty location catalogue')
    existing = [b for name in ('bars', 'coffee', 'pizza')
                for b in json.loads((ROOT / f'public/data/{name}.json').read_text())['bars']]
    output = catalogue(found, existing)
    save(ROOT / 'public/data/locations.json', output)
    print(f"Saved {len(output['bars'])} selectable OSM locations")


if __name__ == '__main__':
    main()
