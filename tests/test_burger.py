import unittest

from scraper.burger import candidates, clean, dataset_offers, product_name

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
    def test_candidates_use_cuisine_or_name(self):
        bars = [
            {'id': 'node/1', 'name': 'Bärengarten', 'cuisine': ['burger'], 'website': 'https://a.example/'},
            {'id': 'node/2', 'name': 'Burger Bar', 'cuisine': [], 'website': 'https://b.example/'},
            {'id': 'node/3', 'name': 'Pizzeria Roma', 'cuisine': ['pizza'], 'website': 'https://c.example/'},
            {'id': 'node/4', 'name': 'Burger ohne Website', 'cuisine': ['burger'], 'website': None},
        ]
        groups = candidates(bars, {})
        self.assertEqual(sorted(group[0]['id'] for group in groups.values()), ['node/1', 'node/2'])

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
