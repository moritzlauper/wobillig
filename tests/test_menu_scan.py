import unittest

from scraper.menu_scan import apply_city_offers, candidates, category_results, recently_read, scan, split

URL = 'https://bar.example/karte'


def row(category, name, price, evidence, **values):
    return {'category': category, 'name': name, 'priceChf': price, 'volumeMl': None, 'diet': 'standard', 'glutenFree': False,
            'style': 'none', 'standardPortion': True, 'lunchOnly': False, 'conditional': False, 'evidence': evidence, 'page': 1, **values}


class MenuScan(unittest.TestCase):
    def test_one_answer_is_checked_with_each_categorys_rules(self):
        answer = {'offers': [
            row('cocktail', 'Negroni', 16, 'Negroni 16.00'),
            row('softdrink', 'Coca-Cola', 5.5, 'Coca-Cola 3.3 dl 5.50', volumeMl=330),
            row('burger', 'Cheeseburger', 24, 'Cheeseburger 24.00'),
            row('ramen', 'Shoyu Ramen', 23, 'Shoyu Ramen 23.00', style='ramen'),
        ]}
        found = split(answer, URL, 0, 1, '')
        self.assertEqual({k: [o['name'] for o in v] for k, v in found.items()},
                         {'cocktail': ['Negroni'], 'softdrink': ['Coca-Cola'], 'burger': ['Cheeseburger'], 'ramen': ['Shoyu Ramen']})
        self.assertEqual(found['softdrink'][0]['volumeMl'], 330)

    def test_rows_in_the_wrong_category_or_conditional_drinks_are_dropped(self):
        answer = {'offers': [
            row('burger', 'Negroni', 16, 'Negroni 16.00'),
            row('cocktail', 'Aperol Spritz', 9, 'Happy Hour Aperol Spritz 9.00', conditional=True),
            row('softdrink', 'Coca-Cola', 5.5, 'Coca-Cola 5.50'),
            row('ramen', 'Shoyu Ramen', 23, 'Shoyu Ramen 23.00'),
        ]}
        self.assertEqual({k: v for k, v in split(answer, URL, 0, 1, '').items() if v}, {})

    def test_candidates_join_burger_venues_and_ramen_shared_menus(self):
        bars = [{'id': 'a', 'name': 'Bar A', 'type': 'bar', 'website': 'https://a.example/'},
                {'id': 'b', 'name': 'Machida Shoten 1', 'type': 'restaurant', 'cuisine': ['ramen'], 'website': 'https://ch.machidashoten.com/'},
                {'id': 'c', 'name': 'Machida Shoten 2', 'type': 'restaurant', 'cuisine': ['ramen'], 'website': 'https://ch.machidashoten.com/'}]
        groups = candidates(bars, {})
        self.assertEqual(sorted(groups), ['a.example', 'ch.machidashoten.com'])
        self.assertEqual(len(groups['ch.machidashoten.com']), 2)

    def test_category_results_keep_unread_venues_apart(self):
        results = {'a': {'status': 'read', 'offers': {'burger': [{'name': 'X'}], 'ramen': []}, 'errors': []},
                   'b': {'status': 'fetch_failed', 'offers': {'burger': [], 'ramen': []}, 'errors': []}}
        self.assertEqual({k: v['status'] for k, v in category_results(results, 'burger').items()}, {'a': 'priced', 'b': 'fetch_failed'})
        self.assertEqual({k: v['status'] for k, v in category_results(results, 'ramen').items()}, {'a': 'no_prices', 'b': 'fetch_failed'})

    def test_city_scan_offers_replace_only_the_categories_it_found(self):
        old = {'name': 'Old Negroni', 'priceChf': 14}
        data = {'cocktail': {'bars': [{'id': 'node/1', 'name': 'Bar', 'offers': [old]}]}, 'softdrink': {'bars': []},
                'burger': {'bars': [{'id': 'node/1', 'name': 'Bar', 'offers': [{'name': 'Burger', 'priceChf': 20}]}]}, 'ramen': {'bars': []}}
        found = split({'offers': [row('cocktail', 'Negroni', 16, 'Negroni 16.00'), row('softdrink', 'Cola', 5, 'Cola 3 dl 5.00', volumeMl=300)]}, URL, 0, 1, '')
        apply_city_offers(data, {'id': 'node/1', 'name': 'Bar', 'lat': 47, 'lon': 8}, found, '2026-10-30T10:00:00+00:00')
        self.assertEqual([o['name'] for o in data['cocktail']['bars'][0]['offers']], ['Negroni'])
        self.assertEqual(data['softdrink']['bars'][0]['offers'][0]['volumeMl'], 300)
        self.assertEqual(data['burger']['bars'][0]['offers'], [{'name': 'Burger', 'priceChf': 20}])

    def test_menu_scan_skips_websites_the_city_scan_read_recently(self):
        checks = {'node/1': {'checkedAt': '2026-10-27T05:00:00+00:00'}, 'node/2': {'checkedAt': '2026-10-01T05:00:00+00:00'}}
        now = '2026-10-30T05:00:00+00:00'
        self.assertTrue(recently_read(checks, [{'id': 'node/1'}], now))
        self.assertFalse(recently_read(checks, [{'id': 'node/2'}], now))
        self.assertFalse(recently_read(checks, [{'id': 'node/1'}, {'id': 'node/3'}], now))

    def test_scan_skips_venues_after_the_time_limit(self):
        class NoFetch:
            def get(self, url):
                raise AssertionError('fetched after the time limit')
        self.assertEqual(scan('Bar', [{'name': 'Bar', 'website': URL}], NoFetch(), None, 40, 60, deadline=0)['status'], 'skipped')


if __name__ == '__main__':
    unittest.main()
