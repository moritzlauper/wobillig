"""Match Basel's official boulevard permits (outdoor seating) to mapped venues.

python -m scraper.outdoor_permits            # refresh from data.bs.ch, then apply
python -m scraper.outdoor_permits --offline  # apply the saved matches only

Source: Kanton Basel-Stadt, Allmendbewilligungen (data.bs.ch dataset 100018,
CC BY 4.0). A permit is assigned only when its name clearly matches a venue
within 60 m; unclear permits stay unassigned. A failed download keeps the saved
matches, so a refresh never drops permits because the portal was unavailable.
Other cities publish no comparable data; the command does nothing there.
"""
import argparse
from datetime import date
import difflib
import json
import math
import re
import unicodedata

import requests

from scraper.cities import CITY, DATA_DIR, STATE_DIR
from scraper.scrape import UA
from scraper.scrape_coffee import save

API = 'https://data.bs.ch/api/explore/v2.1/catalog/datasets/100018/exports/json'
SOURCE = 'https://data.bs.ch/explore/dataset/100018/'
LICENSE = 'CC BY 4.0'
STATE = STATE_DIR / 'outdoor_permits.json'
DATASETS = ('bars', 'coffee', 'pizza', 'locations', 'doner', 'falafel')
MAX_DISTANCE = 60
NEAR = 30
# Words that describe the kind of venue rather than its name.
GENERIC = {'restaurant', 'ristorante', 'ristorantino', 'bar', 'cafe', 'caffe', 'kaffee', 'coffee', 'bistro',
           'pizzeria', 'pizza', 'pub', 'irish', 'lounge', 'gastronomie', 'boulevard', 'gmbh', 'ag', 'sa',
           'basel', 'the', 'la', 'le', 'il', 'da', 'de', 'zum', 'zur', 'im', 'am', 'und', 'and'}
NAME = re.compile(r'^(?:Erweiterung\s+)?Boulevardrestaurant\s+(.+)', re.S)


def permit_name(text):
    match = NAME.match(text.strip())
    if not match:
        return None
    name = re.split(r'\s{2,}|,|\s+(?:Fl[äa]che|Saison\w*|Ganzjahr\w*|R[üu]ckwirkend|Beginn|ab|per)\b', match[1])[0]
    return re.sub(r'\s*\([^)]*\)', '', name).strip(' -') or None


def permit_terms(text):
    """Season and area as stated in the permit text."""
    terms = {'season': 'unspecified'}
    period = re.search(r'(\d{1,2})\.(\d{1,2})\.?\s*(?:-|–|bis)\s*(\d{1,2})\.(\d{1,2})\.?', text)
    if re.search(r'ganzjahr', text, re.I):
        terms['season'] = 'year'
    elif period and re.search(r'saison|jeweils', text, re.I):
        terms.update(season='seasonal', **{'from': f'{int(period[2]):02d}-{int(period[1]):02d}',
                                           'until': f'{int(period[4]):02d}-{int(period[3]):02d}'})
    area = re.search(r'Fl[äa]che:?\s*(\d+(?:[.,]\d+)?)\s*m', text)
    if area:
        terms['areaM2'] = float(area[1].replace(',', '.'))
    return terms


def current_permits(rows, today):
    """Approved permits valid today; one request can cover several areas (rows)."""
    permits = {}
    for row in rows:
        point = row.get('geo_point_2d')
        name = permit_name(row.get('bezeichng') or '')
        if row.get('entsch_bez') != 'bewilligt' or not point or not name:
            continue
        if not (row.get('datum_von') or '9999') <= today <= (row.get('datum_bis') or ''):
            continue
        permit = permits.setdefault(str(row['begehrenid']), {
            'id': str(row['begehrenid']), 'name': name, **permit_terms(row['bezeichng']), 'points': []})
        permit['points'].append((point['lat'], point['lon']))
    return sorted(permits.values(), key=lambda p: p['id'])


def tokens(name, generic=True):
    text = unicodedata.normalize('NFKD', name.casefold()).encode('ascii', 'ignore').decode()
    text = re.sub(r"['`´]", '', text).replace('kebap', 'kebab')
    return [t for t in re.findall(r'[a-z0-9]+', text) if not generic or t not in GENERIC]


def similarity(permit, venue, distance):
    """1 for the same name, about 0.85 or more for clear variants, otherwise 0."""
    full = ''.join(tokens(permit, False))
    if full and full == ''.join(tokens(venue, False)):
        return 1
    a, b = tokens(permit), tokens(venue)
    if not a or not b:
        return 0
    if ''.join(a) == ''.join(b):
        return 1
    if set(a) <= set(b) or set(b) <= set(a):
        return .95
    ratio = difflib.SequenceMatcher(None, ' '.join(a), ' '.join(b)).ratio()
    if ratio >= .85:
        return ratio
    # Very close venues may shorten or extend their name ("Mana Bar" / "ManaBar").
    joined_a, joined_b = ''.join(a), ''.join(b)
    if distance <= NEAR and min(len(joined_a), len(joined_b)) >= 4 and (
            joined_a.startswith(joined_b) or joined_b.startswith(joined_a)):
        return .85
    if distance <= NEAR and len({t for t in set(a) & set(b) if len(t) >= 4}) >= 2:
        return .85
    return 0


def metres(a, b):
    return 6371000 * math.hypot(math.radians(b[0] - a[0]), math.radians(b[1] - a[1]) * math.cos(math.radians(a[0])))


def match(permits, venues):
    """Assign each permit to its best-named venue nearby; returns {venue id: [permits]}."""
    matched = {}
    for permit in permits:
        scored = []
        for venue in venues:
            distance = min(metres(point, (venue['lat'], venue['lon'])) for point in permit['points'])
            if distance <= MAX_DISTANCE:
                score = similarity(permit['name'], venue['name'], distance)
                if score >= .85:
                    scored.append((score, venue['id']))
        best = max((score for score, _ in scored), default=None)
        # A venue mapped as both node and outline can share the best score.
        for venue_id in sorted({venue_id for score, venue_id in scored if score == best}):
            matched.setdefault(venue_id, []).append(permit)
    return matched


def summary(permits):
    seasons = {p['season'] for p in permits}
    season = 'year' if 'year' in seasons else 'seasonal' if seasons == {'seasonal'} else 'unspecified'
    result = {'season': season}
    if season == 'seasonal':
        result.update({key: permits[0][key] for key in ('from', 'until')})
    areas = [p['areaM2'] for p in permits if 'areaM2' in p]
    if areas:
        result['areaM2'] = round(sum(areas), 2)
    return {**result, 'permitIds': [p['id'] for p in permits], 'permitNames': sorted({p['name'] for p in permits})}


def apply(dataset, venues):
    """Set or remove each venue's public permit summary; returns whether anything changed."""
    changed = False
    for bar in dataset['bars']:
        permit = venues.get(bar['id'])
        public = {k: v for k, v in permit.items() if k not in ('permitIds', 'permitNames')} if permit else None
        if bar.get('outdoorPermit') != public:
            changed = True
            if public:
                bar['outdoorPermit'] = public
            else:
                bar.pop('outdoorPermit', None)
    return changed


def fetch():
    params = {'where': 'search("Boulevardrestaurant")',
              'select': 'begehrenid,bezeichng,entsch_bez,datum_von,datum_bis,geo_point_2d'}
    response = requests.get(API, params=params, headers={'User-Agent': UA}, timeout=60)
    response.raise_for_status()
    return response.json()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Apply the saved matches without downloading')
    args = parser.parse_args()
    if CITY != 'basel':
        print(f'No outdoor permit data for {CITY}')
        return
    files = {name: DATA_DIR / f'{name}.json' for name in DATASETS if (DATA_DIR / f'{name}.json').exists()}
    datasets = {name: json.loads(path.read_text()) for name, path in files.items()}
    state = json.loads(STATE.read_text()) if STATE.exists() else None
    if not args.offline:
        try:
            permits = current_permits(fetch(), date.today().isoformat())
            if not permits:
                raise ValueError('No current permits')
            venues = {b['id']: b for dataset in datasets.values() for b in dataset['bars']}
            matched = match(permits, venues.values())
            used = {p['id'] for found in matched.values() for p in found}
            state = {'source': SOURCE, 'license': LICENSE, 'retrievedAt': date.today().isoformat(),
                     'currentPermits': len(permits), 'matchedPermits': len(used),
                     'venues': {venue_id: summary(found) for venue_id, found in sorted(matched.items())}}
            save(STATE, state)
            print(f'Matched {len(used)} of {len(permits)} current boulevard permits to {len(matched)} venues', flush=True)
        except (requests.RequestException, ValueError) as exc:
            print(f'Outdoor permits not refreshed ({type(exc).__name__}); keeping saved matches', flush=True)
    if state is None:
        print('No saved outdoor permit matches')
        return
    for name, dataset in datasets.items():
        if apply(dataset, state['venues']):
            save(files[name], dataset)
            print(f'Updated outdoor permits in {name}.json', flush=True)


if __name__ == '__main__':
    main()
