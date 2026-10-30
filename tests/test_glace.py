import unittest

from scraper.glace import candidates, clean, scan, scoops_in, shops_output

URL = 'https://glace.example/preise'


def row(**values):
    return {'name': 'Becher', 'scoops': 2, 'priceChf': 7.5, 'conditional': False, 'evidence': '2 Kugeln 7.50', 'page': 1, **values}


class GlaceRules(unittest.TestCase):
    def test_keeps_portion_with_scoops_and_price_in_evidence(self):
        self.assertEqual(clean({'offers': [row()]}, URL), [{'scoops': 2, 'price': 7.5, 'evidence': '2 Kugeln 7.50', 'source': URL}])

    def test_scoop_count_must_match_the_evidence(self):
        self.assertEqual(clean({'offers': [row(scoops=3)]}, URL), [])
        self.assertEqual(clean({'offers': [row(evidence='Becher 7.50')]}, URL), [])
        self.assertEqual(scoops_in('eine Kugel 4.20'), 1)
        self.assertIsNone(scoops_in('1 Kugel 4.20, 2 Kugeln 7.50'))

    def test_rejects_sundaes_take_home_and_conditional_prices(self):
        self.assertEqual(clean({'offers': [row(name='Coupe Dänemark')]}, URL), [])
        self.assertEqual(clean({'offers': [row(evidence='2 Kugeln im 1 l Becher 7.50')]}, URL), [])
        self.assertEqual(clean({'offers': [row(conditional=True)]}, URL), [])

    def test_implausible_price_per_scoop_is_dropped(self):
        self.assertEqual(clean({'offers': [row(priceChf=2, evidence='2 Kugeln 2.00')]}, URL), [])

    def test_price_must_be_in_the_text_of_a_text_page(self):
        self.assertEqual(clean({'offers': [row()]}, URL, source_text='2 Kugeln 8.00'), [])

    def test_unread_shops_keep_their_previous_portions(self):
        groups = candidates([{'id': 'node/1', 'name': 'Gelateria', 'website': URL, 'address': 'Seestrasse 1', 'postcode': '8002'},
                             {'id': 'node/2', 'name': 'Eisdiele', 'website': 'https://eis.example/'}], {})
        results = {'glace.example': {'status': 'priced', 'portions': [{'scoops': 1, 'price': 4.5, 'source': URL}]},
                   'eis.example': {'status': 'fetch_failed', 'portions': []}}
        previous = {'Eisdiele': {'name': 'Eisdiele', 'source': 'https://eis.example/', 'checkedOn': '2026-07-01', 'portions': [{'scoops': 1, 'price': 4}]}}
        shops = shops_output(groups, results, previous, '2026-10-30')['shops']
        self.assertEqual([(s['name'], s['checkedOn'], s['portions']) for s in shops],
                         [('Eisdiele', '2026-07-01', [{'scoops': 1, 'price': 4}]), ('Gelateria', '2026-10-30', [{'scoops': 1, 'price': 4.5}])])
        self.assertEqual(shops[1]['address'], 'Seestrasse 1, 8002 Zürich')

    def test_scan_skips_shops_after_the_time_limit(self):
        class NoFetch:
            def get(self, url):
                raise AssertionError('fetched after the time limit')
        self.assertEqual(scan('Gelateria', [{'name': 'Gelateria', 'website': URL}], NoFetch(), None, 40, 60, deadline=0)['status'], 'skipped')


if __name__ == '__main__':
    unittest.main()
