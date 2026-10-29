import unittest

from scraper.gastro import candidates, clean, dataset, scan, volume_ml

URL = 'https://gastro.example/karte'
OBSERVED = '2026-10-28T12:00:00+00:00'


def row(**values):
    return {'name': 'Aperol Spritz', 'priceChf': 14.5, 'volumeMl': None, 'evidence': 'Aperol Spritz 14.50', 'page': 1, **values}


class GastroRules(unittest.TestCase):
    def test_keeps_cocktail_with_verbatim_price(self):
        offers = clean({'offers': [row()]}, 'cocktail', URL)
        self.assertEqual([(o['name'], o['priceChf'], o['volumeMl']) for o in offers], [('Aperol Spritz', 14.5, None)])

    def test_rejects_items_outside_the_category(self):
        self.assertEqual(clean({'offers': [row(name='Stange Bier', evidence='Stange Bier 7.00', priceChf=7)]}, 'cocktail', URL), [])
        self.assertEqual(clean({'offers': [row(name='Cola', evidence='Cola 0,33 l 4.50', priceChf=4.5)]}, 'cocktail', URL), [])

    def test_price_must_appear_in_the_evidence(self):
        self.assertEqual(clean({'offers': [row(evidence='Aperol Spritz')]}, 'cocktail', URL), [])

    def test_drops_a_shot_named_like_a_cocktail(self):
        shot = row(name='Espresso Martini', priceChf=8, evidence='Espresso Martini 8')
        drink = row(name='Espresso Martini', priceChf=18, evidence='Espresso Martini 18 Vodka · Kahlua · Espresso')
        self.assertEqual([o['priceChf'] for o in clean({'offers': [shot, drink]}, 'cocktail', URL)], [18])

    def test_soft_drink_needs_a_serving_size(self):
        cola = row(name='Coca-Cola', priceChf=4.5, evidence='Coca-Cola 0,33 l 4.50')
        self.assertEqual([o['volumeMl'] for o in clean({'offers': [cola]}, 'softdrink', URL)], [330])
        self.assertEqual(clean({'offers': [row(name='Coca-Cola', priceChf=4.5, evidence='Coca-Cola 4.50')]}, 'softdrink', URL), [])

    def test_volume_must_be_a_plausible_serving(self):
        self.assertEqual(volume_ml('Cola 3 dl 4.50'), 300)
        self.assertEqual(volume_ml('Cola 0,33 l 4.50'), 330)
        self.assertIsNone(volume_ml('Cola 5 l 4.50'))
        self.assertIsNone(volume_ml('Cola 20 ml 4.50'))

    def test_bread_is_kept_when_named_and_priced(self):
        offers = clean({'offers': [row(name='Brotkorb', priceChf=6, evidence='Brotkorb 6.00')]}, 'brot', URL)
        self.assertEqual([o['name'] for o in offers], ['Brotkorb'])
        self.assertEqual(clean({'offers': [row(name='Weisswein', priceChf=6, evidence='Weisswein 6.00')]}, 'brot', URL), [])

    def test_page_must_be_inside_the_document(self):
        self.assertEqual(clean({'offers': [row(page=3)]}, 'cocktail', URL, page_count=2), [])


class GastroDataset(unittest.TestCase):
    def test_one_venue_per_website_only(self):
        bars = [
            {'id': 'node/1', 'name': 'Bar A', 'type': 'bar', 'website': 'https://a.example/'},
            {'id': 'node/2', 'name': 'Bar B', 'type': 'bar', 'website': 'https://shared.example/'},
            {'id': 'node/3', 'name': 'Bar C', 'type': 'restaurant', 'website': 'https://shared.example/karte'},
            {'id': 'node/4', 'name': 'Laden', 'type': 'shop', 'website': 'https://shop.example/'},
        ]
        self.assertEqual(sorted(candidates(bars)), ['a.example'])

    def test_dataset_publishes_only_venues_with_offers(self):
        def bar(number):
            return {'id': f'node/{number}', 'name': f'Lokal {number}', 'lat': 47.37, 'lon': 8.54, 'type': 'bar', 'website': f'https://{number}.example/'}
        offer = {'name': 'Aperol Spritz', 'volumeMl': None, 'priceChf': 14.5, 'sourceUrl': URL, 'sourcePage': 1,
                 'evidence': 'Aperol Spritz 14.50', 'extractionModel': 'test'}
        groups = [('a.example', [bar(1)]), ('b.example', [bar(2)]), ('c.example', [bar(3)])]
        results = {'a.example': {'status': 'no_prices', 'offers': []},
                   'b.example': {'status': 'skipped', 'offers': []},
                   'c.example': {'status': 'priced', 'offers': [offer]}}
        previous = {'node/2': [offer]}
        rows = dataset(groups, results, previous, OBSERVED, 'test', 'cocktail')['bars']
        self.assertEqual([r['id'] for r in rows], ['node/2', 'node/3'])
        self.assertEqual(rows[0]['offers'], [offer])


class GastroScan(unittest.TestCase):
    def test_unreadable_pdf_fails_the_venue_instead_of_the_run(self):
        class BrokenPdf:
            def get(self, url):
                return url, 'application/pdf', b'%PDF-1.4 not a complete document'

        class NoModel:
            disabled = False

            def ask(self, blocks, schema, system):
                raise AssertionError('asked the model about an unreadable PDF')

        result = scan('Bar', [{'name': 'Bar', 'website': URL}], BrokenPdf(), NoModel(), 'cocktail', 40, 60, deadline=float('inf'))
        self.assertEqual(result['status'], 'fetch_failed')
        self.assertEqual(result['offers'], [])


if __name__ == '__main__':
    unittest.main()
