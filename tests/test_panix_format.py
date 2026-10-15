import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from scraper.ai_scan import classify_existing
from scraper.estimates import estimate_types


def panix(**changes):
    return dict(dict(name='Adler Panix Perle Hell', volumeMl=290, priceChf=6,
                     sourceUrl='https://hikari.ch/files/25-10-WEB-Drinks.pdf',
                     evidence='Adler Panix Perle Hell (5.2 %) 29cl 6.00',
                     alcoholFree=False, beerType='unknown'), **changes)


class PanixFormatTests(unittest.TestCase):
    def test_corrects_old_ai_draft_without_changing_menu_facts(self):
        offer = panix(beerTypeEstimate={'type': 'draft', 'method': 'ai', 'reason': 'guess'})
        before = {k: v for k, v in offer.items() if k != 'beerTypeEstimate'}
        bars = [{'offers': [offer]}]
        estimate_types(bars)
        self.assertEqual(offer['beerTypeEstimate']['type'], 'bottle')
        self.assertIn('brauereiadler.ch', offer['beerTypeEstimate']['reason'])
        self.assertEqual({k: v for k, v in offer.items() if k != 'beerTypeEstimate'}, before)
        once = copy.deepcopy(bars)
        estimate_types(bars)
        self.assertEqual(bars, once)

    def test_fresh_scan_uses_product_rule_before_ai(self):
        offer = panix()
        client = Mock()
        classify_existing(client, [{'name': 'Hikari', 'offers': [offer]}])
        client.ask.assert_not_called()
        self.assertEqual(offer['beerTypeEstimate']['type'], 'bottle')

    def test_never_generalizes_all_sizes_or_all_29cl_beers(self):
        for changes in ({'volumeMl': 500}, {'name': 'Anderes Lager'}):
            offer = panix(**changes)
            estimate_types([{'offers': [offer]}])
            self.assertNotIn('beerTypeEstimate', offer)

    def test_explicit_serving_and_product_images_take_precedence(self):
        for kind in ('draft', 'bottle', 'can'):
            offer = panix(beerType=kind)
            estimate_types([{'offers': [offer]}])
            self.assertEqual(offer['beerType'], kind)
            self.assertNotIn('beerTypeEstimate', offer)
        offer = panix(evidence='Panix Perle vom Fass 29cl 6.00')
        estimate_types([{'offers': [offer]}])
        self.assertEqual(offer['beerTypeEstimate']['type'], 'draft')
        image = {'type': 'can', 'method': 'ai', 'reason': 'Bild', 'sourceImage': 'https://example.com/can.jpg'}
        offer = panix(beerTypeEstimate=image.copy())
        estimate_types([{'offers': [offer]}])
        self.assertEqual(offer['beerTypeEstimate'], image)

    def test_published_hikari_data_has_correct_size_price_and_format(self):
        bars = json.loads(Path('public/data/bars.json').read_text())['bars']
        bar = next(b for b in bars if b['id'] == 'node/11211942437')
        offer = next(o for o in bar['offers'] if o['name'] == 'Adler Panix Perle Hell')
        self.assertEqual((offer['volumeMl'], offer['priceChf']), (290, 6))
        self.assertEqual(offer['beerTypeEstimate']['type'], 'bottle')
