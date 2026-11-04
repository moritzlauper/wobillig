import json
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
            row('wine', 'Chasselas', 8, 'Chasselas 1 dl 8.00', wineType='white', volumeMl=100),
        ]}
        found = split(answer, URL, 0, 1, '')
        self.assertEqual({k: [o['name'] for o in v] for k, v in found.items()},
                         {'cocktail': ['Negroni'], 'softdrink': ['Coca-Cola'], 'wine': ['Chasselas'], 'burger': ['Cheeseburger'], 'ramen': ['Shoyu Ramen']})
        self.assertEqual(found['softdrink'][0]['volumeMl'], 330)

    def test_wine_by_the_glass_natural_wine_spritzer_and_gluehwein(self):
        answer = {'offers': [
            row('wine', 'Blauburgunder', 7.5, 'Blauburgunder AOC 1 dl 7.50', wineType='red'),
            row('wine', 'Pet Nat', 9, 'Naturwein: Pet Nat 1.5 dl 9.00', wineType='white', natural=True),
            row('wine', 'Riesling', 9, 'Riesling 1 dl 9.00', wineType='white', natural=True),
            row('wine', 'Merlot Flasche', 54, 'Merlot 75 cl 54.00', wineType='red'),
            row('wine', 'Pinot Noir', 8, 'Pinot Noir 8.00', wineType='red'),
            row('wine', 'Gespritzter Weisswein', 6.5, 'Gespritzter Weisswein 3 dl 6.50', wineType='spritzer'),
            row('wine', 'Glühwein', 7, 'Glühwein 7.00', wineType='mulled'),
            row('wine', 'Prosecco', 9, 'Prosecco 1 dl 9.00', wineType='sparkling'),
        ]}
        found = split(answer, URL, 0, 1, 'Blauburgunder AOC 1 dl 7.50 Naturwein: Pet Nat 1.5 dl 9.00 Riesling 1 dl 9.00 Merlot 75 cl 54.00 Pinot Noir 8.00 Gespritzter Weisswein 3 dl 6.50 Glühwein 7.00 Prosecco 1 dl 9.00')
        wine = {o['name']: (o['wineType'], o['volumeMl'], o['natural']) for o in found['wine']}
        # Bottles, glasses without a printed size and sparkling wine stay out; natural only where the page says so.
        self.assertEqual(wine, {'Blauburgunder': ('red', 100, False), 'Pet Nat': ('white', 150, True), 'Riesling': ('white', 100, True),
                                'Gespritzter Weisswein': ('spritzer', 300, False), 'Glühwein': ('mulled', None, False)})
        # The Gespritzter is a cocktail too.
        self.assertEqual([o['name'] for o in found['cocktail']], ['Gespritzter Weisswein'])
        no_label = split({'offers': [row('wine', 'Riesling', 9, 'Riesling 1 dl 9.00', wineType='white', natural=True)]}, URL, 0, 1, 'Riesling 1 dl 9.00')
        self.assertFalse(no_label['wine'][0]['natural'])

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


class KeepUnlisted(unittest.TestCase):
    def test_venues_outside_the_candidates_keep_their_offers(self):
        import tempfile
        from pathlib import Path
        from scraper.datasets import keep_unlisted
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ramen.json'
            path.write_text(json.dumps({'bars': [{'id': 'node/1', 'name': 'Ginger', 'offers': [{'name': 'Shoyu Ramen'}]},
                                                 {'id': 'node/2', 'name': 'Read now', 'offers': [{'name': 'Old Ramen'}]}]}))
            output = keep_unlisted({'bars': []}, path, [('read.example', [{'id': 'node/2'}])])
            # Ginger was not a candidate and keeps its price; the venue read without a price stays out.
            self.assertEqual([bar['name'] for bar in output['bars']], ['Ginger'])


class RemovedVenues(unittest.TestCase):
    def test_a_candidate_read_without_a_price_is_named_as_removed(self):
        import tempfile
        from pathlib import Path
        from scraper.datasets import keep_unlisted
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'burger.json'
            path.write_text(json.dumps({'bars': [{'id': 'node/1', 'name': 'Elsewhere', 'offers': [{'name': 'Burger'}]},
                                                 {'id': 'node/2', 'name': 'Read now', 'offers': [{'name': 'Burger'}]}]}))
            output = keep_unlisted({'bars': []}, path, [('read.example', [{'id': 'node/2'}])])
            self.assertEqual(output['removed'], ['node/2'])
            self.assertEqual([bar['id'] for bar in output['bars']], ['node/1'])


class ChainBranches(unittest.TestCase):
    def test_a_branch_with_its_own_menu_gets_only_that_menu(self):
        from scraper.chains import split_chain
        group = [{'id': 'strand', 'name': 'Hiltl am Strand', 'address': 'Mythenquai 95', 'website': 'https://hiltl.ch/'},
                 {'id': 'haus', 'name': 'Haus Hiltl', 'address': 'Sihlstrasse 28', 'website': 'https://hiltl.ch/'}]
        result = {'status': 'priced', 'offers': {'cocktail': [{'name': 'Hugo', 'sourceUrl': 'https://hiltl.ch/files/food-drinks-amstrand.pdf'},
                                                              {'name': 'Negroni', 'sourceUrl': 'https://hiltl.ch/bar/'}]}}
        split = {key: [o['name'] for o in res['offers']['cocktail']] for key, _group, res in split_chain('hiltl.ch', group, result)}
        self.assertEqual(split, {'hiltl.ch#strand': ['Hugo'], 'hiltl.ch#haus': ['Negroni']})
        # Without branch menus every branch keeps the shared offers under the website's own key.
        shared = {'status': 'priced', 'offers': {'cocktail': [{'name': 'Negroni', 'sourceUrl': 'https://hiltl.ch/bar/'}]}}
        self.assertEqual([key for key, _g, _r in split_chain('hiltl.ch', group, shared)], ['hiltl.ch'])

    def test_hugo_for_seven_fifty_is_a_cocktail(self):
        found = split({'offers': [row('cocktail', 'Hugo', 7.5, 'Hugo 7.50'), row('cocktail', 'Apérol Spritz', 9.5, 'Apérol Spritz 9.50')]}, URL, 0, 1, '')
        self.assertEqual([o['name'] for o in found['cocktail']], ['Hugo', 'Apérol Spritz'])
