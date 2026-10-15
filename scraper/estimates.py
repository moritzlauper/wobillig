"""Keep inferred beer formats separate from source-backed beerType values."""
from collections import Counter, defaultdict
import re


def name_key(value):
    return re.sub(r'[^\w]+', '', value.casefold())


def estimate_types(bars):
    sizes = defaultdict(Counter)
    for bar in bars:
        for offer in bar['offers']:
            if not offer.get('coffeeType') and offer.get('beerType', 'unknown') != 'unknown':
                sizes[offer['volumeMl']][offer['beerType']] += 1
    for bar in bars:
        beer = [o for o in bar['offers'] if not o.get('coffeeType')]
        for offer in beer:
            if offer.get('beerType', 'unknown') != 'unknown':
                offer.pop('beerTypeEstimate', None)
                continue
            if offer.get('beerTypeEstimate', {}).get('method') == 'ai':
                continue
            offer.pop('beerTypeEstimate', None)
            name, volume = offer['name'], offer['volumeMl']
            peers = [o for o in beer if name_key(o['name']) == name_key(name)
                     and o['sourceUrl'] == offer['sourceUrl'] and o['alcoholFree'] == offer['alcoholFree']]
            kind = reason = None
            if re.search(r'\b(?:stange|herrgöttli|humpen|fliessend|grosses\s+bier)\b', name, re.I) or offer.get('serving') == 'stange':
                kind, reason = 'draft', 'Bezeichnung einer ausgeschenkten Bierportion'
            elif re.search(r'\b(?:bügel|fl)\b', name, re.I):
                kind, reason = 'bottle', 'Kurzbezeichnung für Flasche oder Bügelverschluss'
            elif {o['volumeMl'] for o in peers} >= {300, 500} or {o['volumeMl'] for o in peers} >= {250, 500} or {o['volumeMl'] for o in peers} >= {200, 400}:
                if not any(o.get('beerType') in ('bottle', 'can') for o in peers):
                    kind, reason = 'draft', 'Dasselbe Bier auf derselben Karte in mehreren Glasgrössen'
            if not kind and volume:
                counts = sizes[volume]
                if counts:
                    likely, count = counts.most_common(1)[0]
                    if sum(counts.values()) >= 5 and count / sum(counts.values()) >= .8:
                        kind, reason = likely, f'Bei {volume / 100:g} dl überwiegt diese Ausschankart in den belegten Angeboten; die Menge allein ist kein Nachweis'
            if kind:
                offer['beerTypeEstimate'] = {'type': kind, 'reason': reason, 'method': 'rules'}
    return bars
