import unittest

from scraper.streetfood_ai import candidates, clean, dataset, dataset_offers, scan

URL = 'https://kebab.example/menu'
OBSERVED = '2026-10-30T12:00:00+00:00'


def row(**values):
    return {'name': 'Dürüm Kebab', 'food': 'doner', 'portion': 'wrap', 'meat': 'unspecified', 'priceChf': 13.5,
            'standardPortion': True, 'conditional': False, 'evidence': 'Dürüm Kebab 13.50', 'page': 1, **values}


class StreetFoodAI(unittest.TestCase):
    def test_reads_doner_and_falafel_in_one_answer(self):
        falafel = row(name='Falafel Dürüm', food='falafel', meat='unspecified', priceChf=12, evidence='Falafel Dürüm 12.00')
        offers = clean({'offers': [row(), falafel]}, URL)
        self.assertEqual([(o['food'], o['portion'], o['meat'], o['priceChf']) for o in offers],
                         [('doner', 'wrap', 'unspecified', 13.5), ('falafel', 'wrap', 'vegetarian', 12)])

    def test_name_must_match_the_food_and_the_evidence(self):
        self.assertEqual(clean({'offers': [row(food='falafel')]}, URL), [])
        self.assertEqual(clean({'offers': [row(name='Falafel Kebab', evidence='Falafel Kebab 13.50')]}, URL), [])
        self.assertEqual(clean({'offers': [row(evidence='Dürüm 13.50')]}, URL), [])
        self.assertEqual(clean({'offers': [row(evidence='Dürüm Kebab 14.50')]}, URL), [])

    def test_drops_menus_variants_and_vegetarian_doner(self):
        self.assertEqual(clean({'offers': [row(name='Dürüm Kebab Menü', evidence='Dürüm Kebab Menü 13.50')]}, URL), [])
        self.assertEqual(clean({'offers': [row(standardPortion=False)]}, URL), [])
        self.assertEqual(clean({'offers': [row(name='Vegi Dürüm', evidence='Vegi Dürüm 13.50')]}, URL), [])
        self.assertEqual(clean({'offers': [row(portion='other')]}, URL), [])

    def test_candidates_are_likely_kebab_venues(self):
        bars = [{'id': 'a', 'name': 'Bistro', 'type': 'fast_food', 'website': 'https://a.example/'},
                {'id': 'b', 'name': 'Restaurant Rössli', 'type': 'restaurant', 'website': 'https://b.example/'},
                {'id': 'c', 'name': 'Anatolia', 'type': 'restaurant', 'cuisine': ['turkish'], 'website': 'https://c.example/'},
                {'id': 'd', 'name': 'Corner', 'type': 'restaurant', 'website': 'https://d.example/'}]
        self.assertEqual(sorted(candidates(bars, {}, known={'d'})), ['a.example', 'c.example', 'd.example'])

    def test_each_food_gets_its_own_dataset_and_unread_venues_keep_offers(self):
        bar = lambda n: {'id': f'node/{n}', 'name': f'Kebab {n}', 'lat': 47, 'lon': 8, 'type': 'fast_food', 'website': f'https://{n}.example/'}
        both = clean({'offers': [row(), row(name='Falafel Dürüm', food='falafel', priceChf=12, evidence='Falafel Dürüm 12.00')]}, URL)
        groups = {'1.example': [bar(1)], '2.example': [bar(2)]}
        results = {'1.example': {'status': 'priced', 'offers': both}, '2.example': {'status': 'fetch_failed', 'offers': []}}
        previous = {'node/2': dataset_offers(both, 'doner', OBSERVED)}
        doner = dataset(groups, results, previous, OBSERVED, 'test', 'doner')['bars']
        falafel = dataset(groups, results, {}, OBSERVED, 'test', 'falafel')['bars']
        self.assertEqual([(b['id'], [o['foodType'] for o in b['offers']]) for b in doner], [('node/1', ['doner']), ('node/2', ['doner'])])
        self.assertEqual([(b['id'], b['offers'][0]['meatType']) for b in falafel], [('node/1', 'vegetarian')])

    def test_scan_skips_venues_after_the_time_limit(self):
        class NoFetch:
            def get(self, url):
                raise AssertionError('fetched after the time limit')
        self.assertEqual(scan('Kebab', [{'name': 'Kebab', 'website': URL}], NoFetch(), None, 40, 60, deadline=0)['status'], 'skipped')


if __name__ == '__main__':
    unittest.main()
