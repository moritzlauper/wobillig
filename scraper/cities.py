"""Select a city's independent datasets with WOBILLIG_CITY (default: zurich)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CITIES = {'zurich': ('Zürich', 'Q72'), 'bern': ('Bern', 'Q70'), 'basel': ('Basel', 'Q78'), 'lausanne': ('Lausanne', 'Q807'), 'geneva': ('Genève', 'Q71'), 'winterthur': ('Winterthur', 'Q9125'), 'olten': ('Olten', 'Q68129')}
CITY = os.environ.get('WOBILLIG_CITY', 'zurich')
if CITY not in CITIES:
    raise ValueError(f'Unknown WOBILLIG_CITY: {CITY}')
CITY_NAME, WIKIDATA = CITIES[CITY]
DATA_DIR = ROOT / 'public/data' / ('' if CITY == 'zurich' else CITY)
STATE_DIR = ROOT / 'scraper' / ('' if CITY == 'zurich' else f'cities/{CITY}')
CACHE_DIR = ROOT / 'scraper/cache' / CITY
# Geneva covers the Swiss urban surroundings as well as the central municipality.
# Explicit municipal areas keep French neighbours and the rural canton out.
# All discovery/address queries share this area set.
GENEVA_MUNICIPALITIES = (
    ('Genève', 'Q71'), ('Carouge', 'Q69364'), ('Lancy', 'Q64065'),
    ('Vernier', 'Q63922'), ('Meyrin', 'Q68230'), ('Onex', 'Q68240'),
    ('Le Grand-Saconnex', 'Q69714'), ('Pregny-Chambésy', 'Q69822'),
    ('Cologny', 'Q69245'), ('Chêne-Bougeries', 'Q69530'),
    ('Chêne-Bourg', 'Q69035'), ('Thônex', 'Q68201'),
    ('Veyrier', 'Q69587'), ('Troinex', 'Q69817'),
    ('Plan-les-Ouates', 'Q65273'), ('Vandœuvres', 'Q65522'),
)
MUNICIPALITIES = GENEVA_MUNICIPALITIES if CITY == 'geneva' else ((CITY_NAME, WIKIDATA),)
AREA = '(' + ''.join(
    f'area["name"="{name}"]["admin_level"="8"]["wikidata"="{wikidata}"];'
    for name, wikidata in MUNICIPALITIES
) + ')->.city;'


def venue_query(amenities):
    return '[out:json][timeout:90];' + AREA + f'nwr["amenity"~"^({amenities})$"]["name"](area.city);out center tags;'
