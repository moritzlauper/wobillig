"""Select a city's independent datasets with WOBILLIG_CITY (default: zurich)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CITIES = {'zurich': ('Zürich', 'Q72'), 'bern': ('Bern', 'Q70'), 'basel': ('Basel', 'Q78'), 'lausanne': ('Lausanne', 'Q807'), 'geneva': ('Genève', 'Q71')}
CITY = os.environ.get('WOBILLIG_CITY', 'zurich')
if CITY not in CITIES:
    raise ValueError(f'Unknown WOBILLIG_CITY: {CITY}')
CITY_NAME, WIKIDATA = CITIES[CITY]
DATA_DIR = ROOT / 'public/data' / ('' if CITY == 'zurich' else CITY)
STATE_DIR = ROOT / 'scraper' / ('' if CITY == 'zurich' else f'cities/{CITY}')
CACHE_DIR = ROOT / 'scraper/cache' / CITY
AREA = f'area["name"="{CITY_NAME}"]["admin_level"="8"]["wikidata"="{WIKIDATA}"]->.city;'


def venue_query(amenities):
    return '[out:json][timeout:90];' + AREA + f'nwr["amenity"~"^({amenities})$"]["name"](area.city);out center tags;'
