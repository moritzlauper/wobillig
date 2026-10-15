"""Keep inferred beer formats separate from source-backed beerType values."""
import re
from scraper.beer_rules import eligible_offer
from scraper.beer_type import explicit_type


def name_key(value):
    return re.sub(r'[^\w]+', '', value.casefold())


def estimate_types(bars):
    for bar in bars:
        bar['offers'] = [o for o in bar['offers'] if eligible_offer(o)]
        beer = [o for o in bar['offers'] if not o.get('coffeeType') and not o.get('pizzaType')]
        for offer in beer:
            if offer.get('beerType', 'unknown') != 'unknown':
                offer.pop('beerTypeEstimate', None)
                continue
            ai = offer.get('beerTypeEstimate', {}).get('method') == 'ai'
            if ai and offer['beerTypeEstimate'].get('sourceImage') and offer['beerTypeEstimate'].get('type') in ('bottle', 'can'):
                continue  # A linked product photo outweighs portion-size heuristics.
            if not ai or offer['beerTypeEstimate'].get('type') == 'draft':
                offer.pop('beerTypeEstimate', None)
                ai = False
            name = offer['name']
            peers = [o for o in beer if name_key(o['name']) == name_key(name)
                     and o['sourceUrl'] == offer['sourceUrl'] and o['alcoholFree'] == offer['alcoholFree']]
            kind = reason = None
            packaging = any(o.get('beerType') in ('bottle', 'can')
                            or explicit_type(o.get('evidence', '')) in ('bottle', 'can', 'unknown')
                            or (o.get('beerTypeEstimate', {}).get('sourceImage')
                                and o['beerTypeEstimate'].get('type') in ('bottle', 'can')) for o in peers)
            if explicit_type(offer.get('evidence', '')) == 'draft':
                kind, reason = 'draft', 'Explizite Ausschankangabe im gespeicherten Menübeleg'
            # Manufacturer documents this specific 29-cl bottle. Keep it an
            # inference: the venue menu itself does not specify packaging.
            elif (offer.get('volumeMl') == 290
                  and re.search(r'\bpanix[\s-]+perle\b', name, re.I)
                  and explicit_type(offer.get('evidence', '')) is None):
                kind, reason = 'bottle', ('Panix Perle mit 29 cl entspricht der von der Brauerei beschriebenen Flasche; '
                                          'Zuordnung aus Produkt und Menge, nicht ausdrücklich auf der Menükarte. '
                                          'Hersteller: https://www.brauereiadler.ch/brauerei/philosophie')
            elif not packaging and (re.search(r'\b(?:stange|herrgöttli|humpen|fliessend|grosses(?:\s+bier)?|großes(?:\s+bier)?)\b', name, re.I) or offer.get('serving') == 'stange'):
                kind, reason = 'draft', 'Bezeichnung einer ausgeschenkten Bierportion'
            elif re.search(r'\b(?:bügel|fl)\b', name, re.I):
                kind, reason = 'bottle', 'Kurzbezeichnung für Flasche oder Bügelverschluss'
            elif {o['volumeMl'] for o in peers} >= {300, 500} or {o['volumeMl'] for o in peers} >= {250, 500} or {o['volumeMl'] for o in peers} >= {200, 400}:
                if not packaging:
                    kind, reason = 'draft', 'Dasselbe Bier auf derselben Karte in mehreren Glasgrössen'
            if not kind and ai:
                continue
            if kind:
                offer['beerTypeEstimate'] = {'type': kind, 'reason': reason, 'method': 'rules'}
    return bars
