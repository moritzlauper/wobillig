import unittest

from scraper.burger import candidates, clean, dataset, dataset_offers, product_name, scan

URL = 'https://burger.example/menu'
OBSERVED = '2026-10-27T12:00:00+00:00'


def row(**values):
    return {'name': 'Classic Burger', 'priceChf': 22, 'diet': 'standard', 'glutenFree': False, 'standardPortion': True,
            'lunchOnly': False, 'conditional': False, 'evidence': 'Classic Burger Rind, Cheddar 22.00', 'page': 1, **values}


class BurgerRules(unittest.TestCase):
    def test_keeps_standard_burger_with_verbatim_price(self):
        offers = clean({'offers': [row()]}, URL)
        self.assertEqual([(o['name'], o['priceChf'], o['diet'], o['glutenFree']) for o in offers], [('Classic Burger', 22, 'standard', False)])

    def test_vegetarian_label_needs_marker_in_text(self):
        halloumi = row(name='Halloumi Burger', diet='vegetarian', evidence='Halloumi Burger Grill-Halloumi 22.00')
        self.assertEqual(clean({'offers': [halloumi]}, URL)[0]['diet'], 'standard')
        veggie = row(name='Veggie Burger', diet='vegetarian', evidence='Veggie Burger Linsen-Patty 19.00', priceChf=19)
        self.assertEqual(clean({'offers': [veggie]}, URL)[0]['diet'], 'vegetarian')

    def test_vegan_label_needs_marker_in_text(self):
        vegan = row(name='Vegan Burger', diet='vegan', evidence='Vegan Burger Bohnenpatty 21.00', priceChf=21)
        self.assertEqual(clean({'offers': [vegan]}, URL)[0]['diet'], 'vegan')
        unlabelled = row(name='Vegan Burger', diet='vegan', evidence='Burger Bohnenpatty 21.00', priceChf=21)
        self.assertEqual(clean({'offers': [unlabelled]}, URL), [])

    def test_vegetarian_text_downgrades_unmarked_vegan_claim(self):
        offers = clean({'offers': [row(name='Veggie Burger', diet='vegan', evidence='Veggie Burger vegetarisch 19.00', priceChf=19)]}, URL)
        self.assertEqual(offers[0]['diet'], 'vegetarian')

    def test_gluten_free_needs_marker_in_text(self):
        offers = clean({'offers': [row(glutenFree=True, evidence='Classic Burger glutenfrei Bun 22.00')]}, URL)
        self.assertTrue(offers[0]['glutenFree'])
        offers = clean({'offers': [row(glutenFree=True)]}, URL)
        self.assertFalse(offers[0]['glutenFree'])

    def test_rejects_menus_sides_and_non_burgers(self):
        for name in ('Burger Menü', 'Burger Combo mit Pommes', 'Pommes Frites', 'Hot Dog', 'Kids Burger', 'Chicken Wrap', 'Mini-Burger Tartar', 'Kleiner Burger'):
            with self.subTest(name=name):
                self.assertEqual(clean({'offers': [row(name=name, evidence=f'{name} 22.00')]}, URL), [])

    def test_rejects_implausible_prices_and_conditional_offers(self):
        self.assertEqual(clean({'offers': [row(priceChf=5, evidence='Classic Burger 5.00')]}, URL), [])
        self.assertEqual(clean({'offers': [row(conditional=True)]}, URL), [])
        self.assertEqual(clean({'offers': [row(standardPortion=False)]}, URL), [])

    def test_price_must_match_the_text_of_a_text_page(self):
        self.assertEqual(clean({'offers': [row()]}, URL, source_text='Classic Burger 23.00'), [])
        self.assertEqual(len(clean({'offers': [row()]}, URL, source_text='Classic Burger 22.00')), 1)

    def test_page_must_be_inside_the_document(self):
        self.assertEqual(clean({'offers': [row(page=3)]}, URL, page_count=2), [])


class BurgerDataset(unittest.TestCase):
    def test_candidates_cover_restaurant_types_with_a_website(self):
        bars = [
            {'id': 'node/1', 'name': 'Bärengarten', 'type': 'restaurant', 'cuisine': ['burger'], 'website': 'https://a.example/'},
            {'id': 'node/2', 'name': 'Burger Bar', 'type': 'bar', 'cuisine': [], 'website': 'https://b.example/'},
            {'id': 'node/3', 'name': 'Pizzeria Roma', 'type': 'restaurant', 'cuisine': ['pizza'], 'website': 'https://c.example/'},
            {'id': 'node/4', 'name': 'Burger ohne Website', 'type': 'restaurant', 'cuisine': ['burger'], 'website': None},
            {'id': 'node/5', 'name': 'Bäckerei', 'type': 'shop', 'cuisine': [], 'website': 'https://d.example/'},
        ]
        groups = candidates(bars, {})
        self.assertEqual(sorted(group[0]['id'] for group in groups.values()), ['node/1', 'node/2', 'node/3'])

    def test_dataset_publishes_only_venues_with_burger_prices(self):
        def bar(number):
            return {'id': f'node/{number}', 'name': f'Lokal {number}', 'lat': 47.37, 'lon': 8.54, 'type': 'restaurant', 'website': f'https://{number}.example/'}
        offer = {'name': 'Classic Burger', 'priceChf': 22, 'diet': 'standard', 'glutenFree': False, 'lunchOnly': False,
                 'evidence': 'Classic Burger 22.00', 'sourceUrl': URL, 'sourcePage': 1, 'extractionModel': 'test'}
        bars = [('a.example', [bar(1)]), ('b.example', [bar(2)]), ('c.example', [bar(3)])]
        results = {'a.example': {'status': 'no_prices', 'offers': []},
                   'b.example': {'status': 'skipped', 'offers': []},
                   'c.example': {'status': 'priced', 'offers': [offer]}}
        previous = {'node/2': dataset_offers([offer], OBSERVED)}
        rows = dataset(bars, results, previous, OBSERVED, 'test')['bars']
        self.assertEqual([row['id'] for row in rows], ['node/2', 'node/3'])
        self.assertEqual(rows[0]['offers'], previous['node/2'])

    def test_scan_skips_venues_after_the_time_limit(self):
        class NoFetch:
            def get(self, url):
                raise AssertionError('fetched after the time limit')
        result = scan('Lokal', [{'name': 'Lokal', 'website': URL}], NoFetch(), None, 40, 60, deadline=0)
        self.assertEqual(result['status'], 'skipped')
        self.assertEqual(result['offers'], [])

    def test_unreadable_pdf_fails_the_venue_instead_of_the_run(self):
        class BrokenPdf:
            def get(self, url):
                return url, 'application/pdf', b'%PDF-1.4 not a complete document'
        class NoModel:
            disabled = False
            def ask(self, blocks, schema, system):
                raise AssertionError('asked the model about an unreadable PDF')
        result = scan('Lokal', [{'name': 'Lokal', 'website': URL}], BrokenPdf(), NoModel(), 40, 60, deadline=float('inf'))
        self.assertEqual(result['status'], 'fetch_failed')
        self.assertEqual(result['offers'], [])

    def test_product_name_marks_lunch_offers(self):
        self.assertEqual(product_name({'name': 'BIG BURGER', 'lunchOnly': True}), 'Big Burger (Mittagskarte)')

    def test_dataset_offers_keep_labels(self):
        offers = dataset_offers([{'name': 'Veggie Burger', 'diet': 'vegetarian', 'glutenFree': True, 'priceChf': 19,
                                  'lunchOnly': False, 'evidence': 'Veggie Burger glutenfrei 19.00', 'sourceUrl': URL,
                                  'sourcePage': 1, 'extractionModel': 'test'}], OBSERVED)
        self.assertEqual(offers[0]['burgerType'], 'burger')
        self.assertEqual(offers[0]['burgerDiet'], 'vegetarian')
        self.assertTrue(offers[0]['glutenFree'])
        self.assertEqual(offers[0]['confidence'], 'ai')


if __name__ == '__main__':
    unittest.main()
