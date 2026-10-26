"""Private Coop Zurich wine sweep: turns a manual coop.ch listing export into a deal batch.

coop.ch blocks scripted clients, so the listing and the store search are read in a normal
browser at the robots.txt crawl delay and exported as JSON. This module only converts that
export. Offers without a printed "statt" price are skipped, never estimated. Shop listings
carry no end date unless the current Coop brochure prints the same promotion.
"""
import argparse
import hashlib
import io
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pdfplumber
import requests

from scraper.deals import SOURCE

LISTING = 'https://www.coop.ch/de/weine/aktionen/c/SPECIAL_OFFERS_WINE'
WINE_TYPES = {'rotweine': 'red', 'weissweine': 'white', 'roseweine': 'rose', 'schaumweine': 'sparkling',
              'champagner': 'sparkling', 'suess-dessertweine': 'dessert', 'suessweine': 'dessert'}
VOLUME = re.compile(r'(?:(\d+)x\s*)?(\d+(?:\.\d+)?)(cl|ml)')
DATES = re.compile(r'(\d{1,2})\.(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})')


def brochure_money(value):
    """Brochure notation: 51.– and –.95."""
    whole, cents = f'{value:.2f}'.split('.')
    return f'{"–" if whole == "0" else whole}.{"–" if cents == "00" else cents}'


def parse_tile(tile):
    """Returns (offer fields, None) or (None, reason). Only uses what the tile prints."""
    squash = lambda text: ' '.join(text.split())
    lines, label = [squash(line) for line in tile['lines']], squash(tile['label'])
    names = [line for line in lines if label.startswith(line) and len(line) > 3]
    if not names:
        return None, 'Produktname fehlt'
    name = max(names, key=len)
    rest = label[len(name):].strip()
    prices = next((line for line in lines if re.fullmatch(r'CHF \d+\.\d\d statt CHF \d+\.\d\d', line)), None)
    if not prices:
        return None, 'Kein Statt-Preis'
    price, previous = map(float, re.findall(r'\d+\.\d\d', prices))
    printed = re.search(r'(\d{1,2})%', rest)
    discount = round(100 * (1 - price / previous))
    if not 0 < price < previous or printed and abs(100 * (1 - price / previous) - int(printed.group(1))) > 1.5:
        return None, 'Preis und Rabatt passen nicht zusammen'
    volume = next((VOLUME.fullmatch(line) for line in lines[:lines.index(name)] if VOLUME.fullmatch(line)), None)
    if not volume:
        return None, 'Menge fehlt'
    count, size = int(volume.group(1) or 1), float(volume.group(2))
    litres = count * size / (100 if volume.group(3) == 'cl' else 1000)
    # The tile prints the price per decilitre; without it the litre price is plain arithmetic.
    unit = next((float(m.group(1)) * 10 for line in lines if (m := re.fullmatch(r'(\d+\.\d\d)/(?:10cl|100ml)', line))), None)
    if unit is not None and abs(price / litres - unit) > .06:
        return None, 'Literpreis passt nicht zur Menge'
    unit = unit if unit is not None else price / litres
    after = lines[lines.index(name) + 1] if lines.index(name) + 1 < len(lines) else ''
    origin = after if re.fullmatch(r"[A-ZÄÖÜa-zäöüé' ]+(?:, \d{4})?", after) and 'Rated' not in after else None
    quantity = f'{count} × ' * (count > 1) + f'{volume.group(2)} {volume.group(3)}'
    online = 'Online' in lines  # Same criterion as the store search in the browser sweep.
    minimum = re.search(r'ab (\d+)', rest)
    conditions = ['Aktionspreis im Onlineshop' + (', nur online' if online else ''),
                  *([f'ab {minimum.group(1)} Stück'] if minimum else []),
                  *(['online derzeit kein Bestand'] if 'kein Bestand' in rest else []),
                  'Filialpreise können laut Coop abweichen']
    evidence = ' · '.join([volume.group(0), name, *([origin] if origin else []), rest.split(' Aktion')[0], prices, f'{unit / 10:.2f}/10cl'])
    return {'product': name, 'quantity': quantity, 'priceChf': price, 'previousPriceChf': previous,
            'discount': discount, 'priceBasis': 'pro Packung' if count > 1 else 'pro Flasche',
            'unitPrice': {'amount': round(unit, 2), 'unit': 'l'}, 'conditions': ' · '.join(conditions),
            'onlineOnly': online, 'origin': origin, 'wineType': WINE_TYPES.get(tile.get('cat', '')),
            'sourceUrl': 'https://www.coop.ch' + tile['path'], 'evidence': evidence}, None


def brochure_pages(session, day):
    """Text, words and validity of each page of the current regional brochure."""
    for candidate in [day, day - timedelta(days=7)]:
        year, week, _ = candidate.isocalendar()
        base = SOURCE.format(year=year, week=week).rsplit('/pdf/', 1)[0]
        response = session.get(base + '/xml/catalog.xml', timeout=25, allow_redirects=False)
        if response.status_code == 404:
            continue
        response.raise_for_status()
        count = int(ET.fromstring(response.content).get('nofpages'))
        if not 1 <= count <= 60:
            raise ValueError('Unexpected brochure page count')
        pages = []
        for number in range(1, count + 1):
            time.sleep(1)
            data = session.get(f'{base}/pdf/save/bk_{number}.pdf', timeout=30, allow_redirects=False)
            data.raise_for_status()
            if not data.content.startswith(b'%PDF'):
                raise ValueError('Unexpected document response')
            with pdfplumber.open(io.BytesIO(data.content)) as pdf:
                page = pdf.pages[0]
                pages.append({'url': f'{base}/pdf/save/bk_{number}.pdf', 'number': number,
                              'text': page.extract_text() or '', 'words': page.extract_words()})
        return pages
    return []


def page_ranges(text, fallback):
    """Validity ranges printed on a page, with their position in the text."""
    ranges = []
    for match in DATES.finditer(text):
        d1, m1, d2, m2, year = map(int, match.groups())
        ranges.append((match.start(), date(year - (m1 > m2), m1, d1), date(year, m2, d2)))
    return ranges or [(0, *fallback)]


def brochure_match(offer, pages, main):
    """Brochure page that prints the same price pair or an "auf alle <Marke> Weine" promotion."""
    tokens = {word.lower() for word in re.findall(r"[\wÀ-ž'’]{4,}", offer['product'])}
    for page in pages:
        text, words = page['text'], page['words']
        if 'megastore' in text.lower() or 'mmeegg' in text.lower():
            continue  # Megastore inserts do not apply to supermarkets.
        ranges = page_ranges(text, main)
        lowered = text.lower()
        if sum(token in lowered for token in tokens) >= 2:
            for word in words:
                if word['text'] != brochure_money(offer['priceChf']):
                    continue
                for statt in words:
                    if statt['text'] != 'statt' or not -3 < statt['top'] - word['top'] < 80 or abs(statt['x0'] - word['x0']) > 80:
                        continue
                    after = min((w for w in words if abs(w['top'] - statt['top']) < 2 and w['x0'] > statt['x1']), key=lambda w: w['x0'], default=None)
                    if after and after['text'] == brochure_money(offer['previousPriceChf']):
                        position = text.find(f'statt {after["text"]}')
                        return page, max((r for r in ranges if r[0] <= max(position, 0)), key=lambda r: r[0], default=ranges[0])
        for brand in re.findall(r'auf alle\s+([A-ZÄÖÜ][\w’\'-]+)\s+Weine', text):
            if brand.lower() not in offer['product'].lower():
                continue
            anchor = next((w for w in words if w['text'] == brand), None)
            percents = [w for w in words if re.fullmatch(r'\d{1,2}%', w['text']) and anchor and 0 < anchor['top'] - w['top'] < 140 and abs(w['x0'] - anchor['x0']) < 150]
            if percents and int(min(percents, key=lambda w: anchor['top'] - w['top'])['text'][:-1]) == offer['discount']:
                position = text.find(brand)
                return page, max((r for r in ranges if r[0] <= position), key=lambda r: r[0], default=ranges[0])
    return None, None


def build(raw, pages, raw_sha256):
    fetched = datetime.fromisoformat(raw['startedAt'].replace('Z', '+00:00'))
    day = fetched.astimezone(ZoneInfo('Europe/Zurich')).date()
    main = page_ranges(pages[0]['text'], (day, day))[0][1:] if pages else (day, day)
    stores = {sid: s for sid, s in raw['stores'].items() if s['city'] == 'Zürich' and re.fullmatch(r'80\d\d', s['zip'] or '')
              and 47.30 < float(s['lat']) < 47.45 and 8.40 < float(s['lon']) < 8.65 and s['link'].startswith('/de/standorte/')}
    branches = [{'id': f'coop/{sid}', 'chain': 'coop', 'name': s['title'], 'address': s['street'], 'postcode': s['zip'],
                 'lat': float(s['lat']), 'lon': float(s['lon']), 'sourceUrl': 'https://www.coop.ch' + s['link']}
                for sid, s in sorted(stores.items())]
    tiles = list({tile['id']: tile for page in raw['pages'].values() for tile in page}.values())
    offers, skipped = [], {}
    for tile in tiles:
        offer, reason = parse_tile(tile)
        if not offer:
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        page, validity = brochure_match(offer, pages, main) if not offer['onlineOnly'] else (None, None)
        start, end = (validity[1], validity[2]) if page else (day, day)
        if page and not start <= day <= end:
            page = None; start = end = day  # Matching an expired brochure section proves nothing about today.
        checked = raw['avail'].get(tile['id'])
        result = {'id': hashlib.sha256(f'coop-shop:{tile["id"]}:{offer["priceChf"]}:{start}'.encode()).hexdigest()[:24],
                  'chain': 'coop', 'category': 'drinks', **{k: v for k, v in offer.items() if k != 'discount' and v is not None},
                  'validFrom': start.isoformat(), 'validThrough': end.isoformat()}
        if not offer['onlineOnly']:
            result.pop('onlineOnly')
        if page:
            result['brochure'] = {'url': page['url'], 'page': page['number']}
            # The brochure price applies in branches, so the online-price caveat no longer fits.
            result['conditions'] = ' · '.join(['Prospektaktion Region ZZ', 'Solange Vorrat',
                                               *[c for c in result['conditions'].split(' · ') if c.startswith('ab ') or 'kein Bestand' in c]])
        else:
            result['endUnknown'] = True
        if checked is not None and not offer['onlineOnly']:
            result['availableAt'] = sorted({f'coop/{sid}' for sid in checked['ids'] if sid in stores})
        offers.append(result)
    batch = {'source': {'id': 'coop-wine-shop', 'chain': 'coop', 'kind': 'shop', 'label': 'coop.ch · Weinaktionen',
                        'url': LISTING, 'sha256': raw_sha256, 'fetchedAt': fetched.isoformat(),
                        'scopeLabel': 'Onlineshop-Aktionen, Filialverfügbarkeit laut coop.ch-Filialsuche ohne Gewähr, Stadt Zürich'},
             'offers': sorted(offers, key=lambda o: o['id']), 'branches': branches}
    return batch, skipped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('raw', help='Browser export of the coop.ch wine listing and store search')
    parser.add_argument('--output', default='output/deals/coop-wine.json')
    parser.add_argument('--allow-partial', action='store_true', help='Unchecked wines get no branch availability')
    args = parser.parse_args()
    data = Path(args.raw).read_bytes()
    raw = json.loads(data)
    if raw.get('status') != 'done' and not args.allow_partial:
        raise ValueError('Sweep export is incomplete')
    session = requests.Session()
    session.headers['User-Agent'] = 'wobillig.ch private promotion pilot/1.0'
    day = datetime.fromisoformat(raw['startedAt'].replace('Z', '+00:00')).astimezone(ZoneInfo('Europe/Zurich')).date()
    batch, skipped = build(raw, brochure_pages(session, day), hashlib.sha256(data).hexdigest())
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + '\n')
    confirmed = sum('brochure' in o for o in batch['offers'])
    print(f'Private wine sweep prepared: {len(batch["offers"])} offers ({confirmed} also in the brochure), '
          f'{len(batch["branches"])} branches, skipped {skipped or "none"}.')


if __name__ == '__main__':
    main()
