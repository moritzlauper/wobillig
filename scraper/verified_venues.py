"""Keep independently verified coffee locations across OSM/menu refreshes.

The registry contains location metadata only, never drink prices. Reuse an
existing OSM ID wherever available so community contributions stay attached.
"""
import json
from pathlib import Path

from scraper.cities import CITY

REGISTRY = Path(__file__).with_name('verified_coffee_venues.json')


def include_verified_coffee_venues(dataset, city=CITY):
    bars = {bar['id']: dict(bar) for bar in dataset['bars']}
    for venue in json.loads(REGISTRY.read_text()).get(city, []):
        previous = bars.get(venue['id'], {})
        merged = {**previous, **venue}
        defaults = {
            'cuisine': [], 'openingHours': None, 'outdoor': False,
            'offers': [], 'scrapeStatus': 'pending', 'checkedAt': None,
        }
        for key, value in defaults.items():
            merged.setdefault(key, value)
        bars[venue['id']] = merged
    return {**dataset, 'bars': sorted(bars.values(), key=lambda b: b['name'].casefold())}
