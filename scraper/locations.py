"""Publish named OSM food/drink venues for map-based community contributions.

python -m scraper.locations
python -m scraper.locations --venues-file scraper/cache/pizza-venues.json
No menu fetching or invented prices; locations stay outside price comparisons
until a price is contributed. Failed discovery leaves the previous file intact.
"""
from scraper.cities import DATA_DIR, venue_query
import argparse
import json
from pathlib import Path
from scraper.scrape import discover
from scraper.scrape_coffee import save

QUERY = venue_query('restaurant|cafe|fast_food|bar|pub|biergarten')


def catalogue(discovered, existing):
    # Keep the IDs and metadata already used by the price datasets.
    bars = {}
    for b in discovered['bars'] + existing:
        bars[b['id']] = {**bars.get(b['id'], {}), **b, 'offers': [],
                         'scrapeStatus': 'location_only', 'checkedAt': None}
    return {**discovered, 'bars': sorted(bars.values(), key=lambda b: (b['name'].casefold(), b['id']))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venues-file', type=Path, help='Reuse a previously discovered, normalized OSM dataset')
    args = parser.parse_args()
    found = json.loads(args.venues_file.read_text()) if args.venues_file else discover({}, query=QUERY)
    if not found.get('bars'):
        raise ValueError('Refusing to publish an empty location catalogue')
    existing = [b for name in ('bars', 'coffee', 'pizza')
                if (DATA_DIR / f'{name}.json').exists()
                for b in json.loads((DATA_DIR / f'{name}.json').read_text())['bars']]
    output = catalogue(found, existing)
    save(DATA_DIR / 'locations.json', output)
    print(f"Saved {len(output['bars'])} selectable OSM locations")


if __name__ == '__main__':
    main()
