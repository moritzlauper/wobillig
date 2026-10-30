import unittest

from scraper.menu_scan import candidates, category_results, scan, split

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

    def test_scan_skips_venues_after_the_time_limit(self):
        class NoFetch:
            def get(self, url):
                raise AssertionError('fetched after the time limit')
        self.assertEqual(scan('Bar', [{'name': 'Bar', 'website': URL}], NoFetch(), None, 40, 60, deadline=0)['status'], 'skipped')


if __name__ == '__main__':
    unittest.main()
