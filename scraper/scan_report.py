"""Compare a city's full crawl with its starting coverage, without counting re-fetches as discoveries."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path

from scraper.cities import CITY, CITY_NAME, DATA_DIR

FILES = {'beer': 'bars', 'coffee': 'coffee', 'pizza': 'pizza'}


def coverage(bars):
    products = {}
    priced = set()
    bottles = set()
    offers = 0
    for bar in bars:
        for offer in bar.get('offers', []):
            priced.add(bar['id'])
            offers += 1
            # Sources, timestamps and inferred serving formats are not new
            # products. Coffee varieties use their canonical category names.
            key = json.dumps([bar['id'], offer.get('coffeeType') or offer.get('pizzaType')
                              or ' '.join(offer['name'].casefold().split()),
                              offer.get('volumeMl'), bool(offer.get('alcoholFree')),
                              offer.get('serving')], ensure_ascii=False)
            products.setdefault(key, set()).add(offer['priceChf'])
            kind = offer.get('beerType', 'unknown')
            if kind == 'unknown':
                kind = offer.get('beerTypeEstimate', {}).get('type')
            if kind == 'bottle' and not offer.get('coffeeType') and not offer.get('pizzaType'):
                bottles.add(bar['id'])
    return {'venues': len(bars), 'pricedVenues': len(priced), 'offers': offers,
            'products': len(products), 'bottleVenues': len(bottles),
            'pricedVenueIds': sorted(priced),
            'productPrices': {key: sorted(value) for key, value in sorted(products.items())}}


def snapshot(directory=DATA_DIR):
    return {'city': CITY, 'recordedAt': datetime.now(timezone.utc).isoformat(),
            'categories': {category: coverage(json.loads((directory / (name + '.json')).read_text())['bars'])
                           for category, name in FILES.items()}}


def compare(before, after):
    if before['city'] != after['city']:
        raise ValueError('Cannot compare different cities')
    result = {}
    for category in FILES:
        a, b = before['categories'][category], after['categories'][category]
        old, new = a['productPrices'], b['productPrices']
        result[category] = {
            'before': {k: a[k] for k in ('venues', 'pricedVenues', 'offers', 'products', 'bottleVenues')},
            'after': {k: b[k] for k in ('venues', 'pricedVenues', 'offers', 'products', 'bottleVenues')},
            'newPricedVenues': len(set(b['pricedVenueIds']) - set(a['pricedVenueIds'])),
            'lostPricedVenues': len(set(a['pricedVenueIds']) - set(b['pricedVenueIds'])),
            'newProducts': len(new.keys() - old.keys()),
            'removedProducts': len(old.keys() - new.keys()),
            'changedPrices': sum(old[key] != new[key] for key in old.keys() & new.keys()),
        }
    return {'city': before['city'], 'startedAt': before['recordedAt'],
            'finishedAt': after['recordedAt'], 'categories': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--baseline', type=Path)
    mode.add_argument('--compare', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--status', default='success')
    args = parser.parse_args()
    current = snapshot()
    if args.baseline:
        args.baseline.write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n')
        return
    if not args.output:
        parser.error('--compare requires --output')
    report = {**compare(json.loads(args.compare.read_text()), current), 'status': args.status}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    lines = [f'### Scan coverage: {CITY_NAME} ({args.status})', '',
             '| Category | Priced venues before → after | Newly priced venues | New products/portions | Changed prices | Removed products/portions |',
             '| --- | --- | --- | --- | --- | --- |']
    for category, value in report['categories'].items():
        lines.append(f"| {category} | {value['before']['pricedVenues']} → {value['after']['pricedVenues']} | {value['newPricedVenues']} | {value['newProducts']} | {value['changedPrices']} | {value['removedProducts']} |")
    lines += ['', 'Source/date/serving-format updates alone do not count as new products. '
              'This reports crawl results before publication; concurrent branch edits may be preserved instead.', '']
    summary = '\n'.join(lines)
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(summary)


if __name__ == '__main__':
    main()
