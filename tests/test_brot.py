import unittest

from scraper.brot import bread_type, candidates, clean, dataset, dataset_offers, product_name, scan, weight_grams

URL = 'https://brot.example/sortiment'
OBSERVED = '2026-10-28T12:00:00+00:00'


def row(**values):
    return {'name': 'Ruchbrot', 'priceChf': 4.5, 'conditional': False, 'evidence': 'Ruchbrot 500 g 4.50', 'page': 1, **values}


class BreadRules(unittest.TestCase):
    def test_keeps_loaf_with_weight_and_price_in_evidence(self):
        offers = clean({'offers': [row()]}, URL)
        self.assertEqual([(o['name'], o['weightGrams'], o['priceChf'], o['pricePerKiloChf']) for o in offers], [('Ruchbrot', 500, 4.5, 9.0)])

    def test_each_size_is_its_own_offer_and_compares_per_kilo(self):
        offers = clean({'offers': [row(), row(priceChf=8, evidence='Ruchbrot 1 kg 8.00')]}, URL)
        self.assertEqual(sorted((o['weightGrams'], o['pricePerKiloChf']) for o in offers), [(500, 9.0), (1000, 8.0)])

    def test_weight_must_be_in_the_evidence(self):
        self.assertEqual(clean({'offers': [row(evidence='Ruchbrot 4.50')]}, URL), [])

    def test_ambiguous_weight_is_dropped(self):
        self.assertEqual(clean({'offers': [row(evidence='Ruchbrot 500 g oder 1 kg 4.50')]}, URL), [])

    def test_implausible_kilo_price_is_dropped(self):
        self.assertEqual(clean({'offers': [row(priceChf=0.9, evidence='Ruchbrot 500 g 0.90')]}, URL), [])
        self.assertEqual(clean({'offers': [row(priceChf=40, evidence='Ruchbrot 500 g 40.00')]}, URL), [])

    def test_rejects_rolls_sandwiches_and_baskets(self):
        for name in ('Brötchen', 'Sandwich Ruchbrot', 'Toast', 'Brotkorb', 'Brotaufstrich', 'Burger Brot'):
            with self.subTest(name=name):
                self.assertEqual(clean({'offers': [row(name=name, evidence=f'{name} 500 g 4.50')]}, URL), [])

    def test_keeps_breads_whose_name_contains_excluded_words(self):
        offers = clean({'offers': [row(name='Toastbrot', evidence='Toastbrot 750 g 3.50', priceChf=3.5)]}, URL)
        self.assertEqual(len(offers), 1)

    def test_conditional_offers_are_dropped(self):
        self.assertEqual(clean({'offers': [row(conditional=True)]}, URL), [])

    def test_price_must_match_the_text_of_a_text_page(self):
        self.assertEqual(clean({'offers': [row()]}, URL, source_text='Ruchbrot 500 g 5.00'), [])
        self.assertEqual(len(clean({'offers': [row()]}, URL, source_text='Ruchbrot 500 g 4.50')), 1)

    def test_page_must_be_inside_the_document(self):
        self.assertEqual(clean({'offers': [row(page=3)]}, URL, page_count=2), [])


class BreadComparison(unittest.TestCase):
    def test_weight_in_grams_and_kilograms(self):
        self.assertEqual(weight_grams('Ruchbrot 500 g 4.50'), 500)
        self.assertEqual(weight_grams('Ruchbrot 1 kg 8.00'), 1000)
        self.assertEqual(weight_grams('Vollkornbrot 1,5 kg'), 1500)
        self.assertEqual(weight_grams('Ruchbrot 500g'), 500)
        self.assertIsNone(weight_grams('Ruchbrot 4.50'))

    def test_breads_are_grouped_so_that_different_loaves_are_not_ranked_together(self):
        self.assertEqual([bread_type(n) for n in ('Vollkornbrot', 'Ruchbrot', 'Halbweissbrot', 'Weissbrot', 'Zopf')],
                         ['vollkorn', 'ruch', 'ruch', 'weiss', 'spezial'])

    def test_product_name_states_the_weight_once(self):
        self.assertEqual(product_name({'name': 'RUCHBROT 500 g', 'weightGrams': 500}), 'Ruchbrot, 500 g')
        self.assertEqual(product_name({'name': 'Vollkornbrot', 'weightGrams': 1500}), 'Vollkornbrot, 1.5 kg')


class BreadDataset(unittest.TestCase):
    def test_candidates_are_bakeries_with_a_website(self):
        bars = [
            {'id': 'node/1', 'name': 'Bäckerei Eins', 'type': 'bakery', 'website': 'https://a.example/'},
            {'id': 'node/2', 'name': 'Bäckerei ohne Website', 'type': 'bakery', 'website': None},
            {'id': 'node/3', 'name': 'Filiale A', 'type': 'bakery', 'website': 'https://shared.example/a'},
            {'id': 'node/4', 'name': 'Filiale B', 'type': 'bakery', 'website': 'https://shared.example/b'},
            {'id': 'node/5', 'name': 'Bäckerei mit Override', 'type': 'bakery', 'website': None},
        ]
        groups = candidates(bars, {'node/5': 'https://e.example/'})
        self.assertEqual(sorted(group[0]['id'] for group in groups.values()), ['node/1', 'node/5'])

    def test_dataset_publishes_only_bakeries_with_bread_prices(self):
        def bar(number):
            return {'id': f'node/{number}', 'name': f'Bäckerei {number}', 'lat': 47.37, 'lon': 8.54, 'type': 'bakery', 'website': f'https://{number}.example/'}
        offer = {'name': 'Ruchbrot', 'brotType': 'ruch', 'weightGrams': 500, 'priceChf': 4.5, 'pricePerKiloChf': 9.0,
                 'evidence': 'Ruchbrot 500 g 4.50', 'sourceUrl': URL, 'sourcePage': 1, 'extractionModel': 'test'}
        bars = [('a.example', [bar(1)]), ('b.example', [bar(2)]), ('c.example', [bar(3)])]
        results = {'a.example': {'status': 'no_prices', 'offers': []},
                   'b.example': {'status': 'skipped', 'offers': []},
                   'c.example': {'status': 'priced', 'offers': [offer]}}
        previous = {'node/2': dataset_offers([offer], OBSERVED)}
        rows = dataset(bars, results, previous, OBSERVED, 'test')['bars']
        self.assertEqual([row['id'] for row in rows], ['node/2', 'node/3'])
        self.assertEqual(rows[0]['offers'], previous['node/2'])
        self.assertEqual(rows[1]['offers'][0]['pricePerKiloChf'], 9.0)

    def test_scan_skips_venues_after_the_time_limit(self):
        class NoFetch:
            def get(self, url):
                raise AssertionError('fetched after the time limit')
        result = scan('Bäckerei', [{'name': 'Bäckerei', 'website': URL}], NoFetch(), None, 40, 60, deadline=0)
        self.assertEqual(result['status'], 'skipped')
