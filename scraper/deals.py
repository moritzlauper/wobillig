"""Private Coop Zurich pilot. Conservative extraction of a five-offer front page.

Only published PDFs are fetched. Unknown layouts or unclear prices fail closed.
No shop-page access checks are bypassed. OSM places are candidates, not evidence
that a promotion applies in a branch. All imports remain in the admin preview.
"""
import argparse
import hashlib
import io
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pdfplumber
import requests

SOURCE = 'https://epaper.coop.ch/catalogs/AM_AKMA_W{week:02}_{year}_DE_ZZ--SHORTTERM/pdf/save/bk_1.pdf'
# Reviewed front-page layout: headline offer, two middle offers, two bottom offers.
SLOTS = [((35, 145, 125, 255), (235, 335, 565, 365)),
         ((200, 380, 290, 475), (35, 535, 290, 565)),
         ((465, 380, 565, 475), (300, 535, 565, 565)),
         ((200, 575, 290, 665), (35, 720, 290, 760)),
         ((465, 575, 565, 665), (300, 720, 565, 760))]


def money(text):
    return float(text.replace('–', '0').replace('−', '0'))


def parse_pdf(data, source_url, fetched_at):
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        if len(pdf.pages) != 1:
            raise ValueError('Unknown brochure page count')
        page = pdf.pages[0]
        if abs(page.width - 595.276) > 1 or abs(page.height - 841.89) > 1:
            raise ValueError('Unknown page format')
        full = page.extract_text() or ''
        dates = re.search(r'(\d{1,2})\.(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})', full)
        if not dates or 'Donnerstag bis Mittwoch' not in full or len(re.findall(r'\bstatt\b', full)) != 5:
            raise ValueError('Missing validity or unknown offer layout')
        d1, m1, d2, m2, year = map(int, dates.groups())
        start = date(year - (m1 > m2), m1, d1)
        end = date(year, m2, d2)
        if not 0 <= (end - start).days <= 7:
            raise ValueError('Unexpected validity period')
        offers = []
        for price_box, text_box in SLOTS:
            prices = page.crop(price_box).extract_text() or ''
            description = page.crop(text_box).extract_text() or ''
            price = re.findall(r'^([\d–]+\.[\d–]+)\s*$', prices, re.M)
            previous = re.findall(r'statt\s+([\d–]+\.[\d–]+)', prices)
            discount = re.findall(r'(\d{1,2})%', prices)
            if len(price) != 1 or len(previous) != 1 or len(discount) != 1 or len(description.strip()) < 12:
                raise ValueError('Ambiguous price or missing product description')
            current, old = money(price[0]), money(previous[0])
            if not 0 < current < old or abs(100 * (1 - current / old) - int(discount[0])) > 1.1:
                raise ValueError('Price and discount disagree')
            per_100 = 'per 100 g' in prices
            quantity = re.search(r'\d+\s*[×x]\s*\d+(?:[.,]\d+)?\s*(?:kg|g|cl|ml|l)\b|\d+ Stück, ca\. \d+ g|ca\. \d+ g|per Stück|per kg', description)
            if not quantity:
                raise ValueError('Unclear pack size or quantity')
            quantity = quantity.group(0)
            conditions = ['Solange Vorrat']
            minimum = re.search(r'ab \d+ Stück', prices)
            if minimum:
                conditions.append(minimum.group(0))
            if 'haushaltsüblichen Mengen' in description:
                conditions.append('Verkauf nur in haushaltsüblichen Mengen')
            product = ' '.join(description.splitlines())
            unit = None
            if per_100:
                unit = {'amount': round(current * 10, 2), 'unit': 'kg'}
            elif quantity == 'per Stück':
                unit = {'amount': current, 'unit': 'piece'}
            elif quantity == 'per kg':
                unit = {'amount': current, 'unit': 'kg'}
            else:
                pack = re.fullmatch(r'(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|cl|ml|l)', quantity)
                if pack:
                    count, size, measure = pack.groups()
                    base = float(count) * float(size.replace(',', '.')) * {'kg': 1, 'g': .001, 'l': 1, 'cl': .01, 'ml': .001}[measure]
                    unit = {'amount': round(current / base, 2), 'unit': 'kg' if measure in ['g', 'kg'] else 'l'}
            offers.append({
                'id': hashlib.sha256(f'coop-zz:{product}:{start}:{end}'.encode()).hexdigest()[:24],
                'chain': 'coop', 'product': product, 'quantity': quantity,
                'category': 'drinks' if re.search(r'Amarone|\bVino\b|\bWein\b|\bBier\b', product) else 'food',
                'priceChf': current, 'previousPriceChf': old, 'priceBasis': 'pro 100 g' if per_100 else 'pro Stück' if quantity == 'per Stück' else 'pro kg' if quantity == 'per kg' else 'pro Packung',
                **({'unitPrice': unit} if unit else {}), 'conditions': ' · '.join(conditions),
                'validFrom': start.isoformat(), 'validThrough': end.isoformat(),
                'sourceUrl': source_url, 'sourcePage': 1, 'evidence': prices + '\n' + description,
            })
    return {'source': {'id': 'coop-zz-front-page', 'chain': 'coop', 'label': 'Coop Aktionsprospekt · Titelseite',
                      'url': source_url, 'sha256': hashlib.sha256(data).hexdigest(), 'fetchedAt': fetched_at,
                      'scopeLabel': 'Prospektausgabe ZZ · regionale und filialspezifische Gültigkeit noch zu prüfen'},
            'offers': offers, 'branches': []}


def branch_candidates(features):
    branches = []
    for item in features:
        p = item.get('properties', {})
        if p.get('osm_key') != 'shop' or p.get('osm_value') != 'supermarket' or p.get('name') != 'Coop' or p.get('city') != 'Zürich' or not p.get('street') or not p.get('housenumber'):
            continue
        kind = {'N': 'node', 'W': 'way', 'R': 'relation'}.get(p.get('osm_type'))
        if not kind:
            continue
        lon, lat = item['geometry']['coordinates']
        id_ = f'{kind}/{p["osm_id"]}'
        branches.append({'id': id_, 'chain': 'coop', 'name': f'Coop {p["street"]}',
                         'address': f'{p["street"]} {p["housenumber"]}', 'postcode': p.get('postcode', ''),
                         'lat': lat, 'lon': lon, 'sourceUrl': f'https://www.openstreetmap.org/{id_}'})
    return sorted(branches, key=lambda b: b['id'])[:10]


def download_current(session, today):
    # The current published edition may be labelled with the prior ISO week.
    for day in [today, today - timedelta(days=7)]:
        year, week, _ = day.isocalendar()
        url = SOURCE.format(year=year, week=week)
        response = session.get(url, timeout=25, allow_redirects=False)
        if response.status_code == 404:
            continue
        response.raise_for_status()
        if not response.content.startswith(b'%PDF') or len(response.content) > 10_000_000:
            raise ValueError('Unexpected document response')
        batch = parse_pdf(response.content, url, datetime.now(timezone.utc).isoformat())
        if all(o['validFrom'] <= today.isoformat() <= o['validThrough'] for o in batch['offers']):
            return batch
    raise ValueError('No current, parseable brochure found; previous data must not be extended')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/deals/coop-zurich.json')
    args = parser.parse_args()
    session = requests.Session()
    session.headers['User-Agent'] = 'wobillig.ch private promotion pilot/1.0'
    batch = download_current(session, datetime.now(ZoneInfo('Europe/Zurich')).date())
    response = session.get('https://photon.komoot.io/api/', params={'q': 'Coop Zürich', 'lat': 47.378, 'lon': 8.535, 'limit': 12}, timeout=20)
    response.raise_for_status()
    batch['branches'] = branch_candidates(response.json().get('features', []))
    if not batch['branches']:
        raise ValueError('No supermarket candidates found')
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(target)
    print(f'Private pilot prepared: {len(batch["offers"])} offers, {len(batch["branches"])} unverified branch candidates.')


if __name__ == '__main__':
    main()
