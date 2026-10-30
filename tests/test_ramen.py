import unittest

from scraper.ai import BudgetExhausted
from scraper.ramen import ADDRESS_OVERRIDES, clean, crawl, candidates, dataset, product_name, scan

URL = 'https://ramen.example/menu'
OBSERVED = '2026-10-26T12:00:00+00:00'


def row(**values):
    return {'name': 'Shoyu Ramen', 'priceChf': 22, 'style': 'ramen', 'standardPortion': True, 'lunchOnly': False,
            'conditional': False, 'evidence': 'Shoyu Ramen Klare Suppe 22.00', 'page': 1, **values}


class Fetcher:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url):
        if url not in self.pages:
            raise ValueError('not found')
        return (url, *self.pages[url])


class Client:
    disabled = False

    def __init__(self, offers=(), error=None):
        self.offers, self.error = list(offers), error

    def ask(self, content, schema, system):
        if self.error:
            raise self.error
        return {'offers': self.offers}


BAR = {'id': 'node/1', 'name': 'Mori Ramen', 'lat': 47.37, 'lon': 8.54, 'address': 'Hottingerstrasse 4', 'postcode': '8032',
       'type': 'restaurant', 'website': 'https://ramen.example/', 'cuisine': ['ramen'], 'openingHours': None, 'outdoor': False}
HOME = '<html><body><a href="/menu">Speisekarte</a><a href="/team">Team</a></body></html>'
MENU = '<html><body><h2>Ramen</h2><p>Shoyu Ramen Klare Suppe 22.00</p></body></html>'
PAGES = {'https://ramen.example/': ('text/html', HOME.encode()), 'https://ramen.example/menu': ('text/html', MENU.encode())}


class RamenTests(unittest.TestCase):
    def test_only_verified_unconditional_standard_ramen_prices_are_kept(self):
        text = 'Shoyu Ramen Klare Suppe 22.00\nMiso Ramen 24.00'
        self.assertEqual(clean({'offers': [row()]}, URL, source_text=text)[0]['priceChf'], 22)
        rejected = [row(conditional=True), row(standardPortion=False), row(priceChf=24), row(name='Tonkotsu Ramen'),
                    row(priceChf=8, evidence='Shoyu Ramen 8.00'), row(page=2), row(style='udon')]
        for value in rejected:
            with self.subTest(value=value):
                self.assertEqual(clean({'offers': [value]}, URL, source_text=text), [])
        # Scans have no text layer; the evidence must still name the dish and price.
        self.assertEqual(len(clean({'offers': [row(name='Paitan Ramen')]}, URL)), 0)
        self.assertEqual(len(clean({'offers': [row(name='Paitan Ramen', evidence='PAITAN RAMEN 22.0')]}, URL)), 1)

    def test_names_only_in_japanese_script_are_dropped(self):
        named = row(name='醤油ラーメン', evidence='醤油ラーメン 25.80', priceChf=25.8)
        self.assertEqual(clean({'offers': [named]}, URL), [])
        self.assertEqual(product_name({'name': '· Shoyu Ramen', 'lunchOnly': False}), 'Shoyu Ramen')

    def test_product_names_are_short_and_mark_lunch_prices(self):
        self.assertEqual(product_name({'name': 'Yokohama Style Ramen (横浜家系ラーメン)', 'lunchOnly': False}), 'Yokohama Style Ramen')
        self.assertEqual(product_name({'name': 'Tantan Men / 担々麺', 'lunchOnly': False}), 'Tantan Men')
        self.assertEqual(product_name({'name': 'PAITAN RAMEN', 'lunchOnly': False}), 'Paitan Ramen')
        self.assertEqual(product_name({'name': 'Gaijin Tonkotsu Ramen', 'lunchOnly': True}), 'Gaijin Tonkotsu Ramen (Mittagskarte)')

    def test_candidates_need_ramen_cuisine_or_name_and_a_reviewed_shared_menu(self):
        bars = [{**BAR, 'id': 'node/2', 'name': 'Yume Ramen', 'website': 'https://www.yume-ramen.ch'},
                {**BAR, 'id': 'node/3', 'name': 'Yume-Ramen', 'website': 'https://www.yume-ramen.ch/'},
                {**BAR, 'id': 'node/4', 'name': 'Machida Shoten', 'website': 'https://ch.machidashoten.com/'},
                {**BAR, 'id': 'node/5', 'name': 'Machida Shoten', 'website': 'https://ch.machidashoten.com/'},
                {**BAR, 'id': 'node/6', 'name': 'Pizzeria', 'cuisine': ['pizza'], 'website': 'https://pizza.example/'},
                {**BAR, 'id': 'node/7', 'name': 'Sushi', 'cuisine': ['japanese'], 'website': None},
                {**BAR, 'id': 'node/8', 'name': 'Sushi Bar', 'cuisine': ['japanese'], 'website': 'https://sushi.example/'}]
        found = candidates(bars, {'node/8': 'https://sushi-override.example/'})
        self.assertEqual(set(found), {'ch.machidashoten.com', 'sushi-override.example'})
        self.assertEqual(len(found['ch.machidashoten.com']), 2)
        self.assertEqual(candidates([{**BAR, 'id': 'node/4', 'name': 'Samurai VII', 'website': 'https://samurai.example/',
                                      'address': None, 'postcode': None}], {})['samurai.example'][0]['address'], None)
        self.assertIn('node/4605571617', ADDRESS_OVERRIDES)

    def test_crawl_follows_menu_links_and_collects_ramen_documents(self):
        result = crawl('https://ramen.example/', Fetcher(PAGES), 120)
        self.assertEqual(result['visited'], 2)
        self.assertEqual([d['url'] for d in result['documents']], ['https://ramen.example/menu'])
        self.assertEqual(result['errors'], [])

    def test_scan_reports_status_without_inventing_offers(self):
        priced = scan('ramen.example', [BAR], Fetcher(PAGES), Client([row()]), 120, 60)
        self.assertEqual((priced['status'], priced['offers'][0]['name'], priced['offers'][0]['priceChf']), ('priced', 'Shoyu Ramen', 22))
        self.assertEqual(scan('ramen.example', [BAR], Fetcher(PAGES), Client(), 120, 60)['status'], 'no_prices')
        self.assertEqual(scan('ramen.example', [BAR], Fetcher(PAGES), Client(error=BudgetExhausted()), 120, 60)['status'], 'fetch_failed')
        # The menu page linked from the home page could not be read.
        self.assertEqual(scan('ramen.example', [BAR], Fetcher({'https://ramen.example/': PAGES['https://ramen.example/']}), Client(), 120, 60)['status'], 'fetch_failed')
        # Prices the page text does not confirm are dropped, but that is no proof that ramen is gone.
        unconfirmed = Client([row(name='Tonkotsu Ramen', evidence='Tonkotsu Ramen 22.00')])
        self.assertEqual(scan('ramen.example', [BAR], Fetcher(PAGES), unconfirmed, 120, 60)['status'], 'unverified')

    def test_dataset_matches_other_categories_and_keeps_unread_venues(self):
        priced = {'status': 'priced', 'offers': [{'name': 'Shoyu Ramen', 'priceChf': 22, 'sourceUrl': URL, 'evidence': 'Shoyu Ramen 22.00',
                                                  'sourcePage': 1, 'extractionModel': 'm', 'lunchOnly': False}]}
        failed = {'status': 'fetch_failed', 'offers': []}
        previous = {'node/9': [{'name': 'Miso Ramen', 'priceChf': 24, 'ramenType': 'ramen', 'volumeMl': None, 'alcoholFree': True}]}
        out = dataset([('ramen.example', [BAR])], {'ramen.example': priced}, previous, OBSERVED, 'Quelle')
        bar = out['bars'][0]
        self.assertEqual((bar['offers'][0]['ramenType'], bar['offers'][0]['volumeMl'], bar['offers'][0]['name']), ('ramen', None, 'Shoyu Ramen'))
        self.assertEqual(bar['scrapeStatus'], 'prices_found')
        kept = dataset([('ramen.example', [{**BAR, 'id': 'node/9'}])], {'ramen.example': failed}, previous, OBSERVED, 'Quelle')
        self.assertEqual(kept['bars'][0]['offers'][0]['name'], 'Miso Ramen')
        self.assertEqual(kept['bars'][0]['scrapeStatus'], 'fetch_failed')
        cleared = dataset([('ramen.example', [{**BAR, 'id': 'node/9'}])], {'ramen.example': {'status': 'no_prices', 'offers': []}}, previous, OBSERVED, 'Quelle')
        self.assertEqual(cleared['bars'][0]['offers'], [])


if __name__ == '__main__':
    unittest.main()
