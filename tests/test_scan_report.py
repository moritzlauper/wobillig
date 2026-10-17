import unittest
from scraper.scan_report import compare, coverage, FILES


def record(bars):
    return {'city': 'basel', 'recordedAt': '2026-10-17',
            'categories': {category: coverage(bars) for category in FILES}}


def bar(id='1', price=6, **extra):
    return {'id': id, 'offers': [{'name': 'Lager', 'volumeMl': 330,
                                 'priceChf': price, 'alcoholFree': False, **extra}]}


class ScanReportTests(unittest.TestCase):
    def test_refetch_and_reclassification_are_not_discoveries(self):
        before = record([bar(sourceUrl='old', observedAt='old')])
        after = record([bar(sourceUrl='new', observedAt='new', beerType='bottle')])
        result = compare(before, after)['categories']['beer']
        self.assertEqual(result['newProducts'], 0)
        self.assertEqual(result['changedPrices'], 0)
        self.assertEqual(result['after']['bottleVenues'], 1)

    def test_price_changes_are_separate_from_new_products_and_venues(self):
        result = compare(record([bar()]), record([bar(price=7), bar('2')]))['categories']['beer']
        self.assertEqual((result['newPricedVenues'], result['newProducts'], result['changedPrices']), (1, 1, 1))

    def test_duplicate_sources_and_order_do_not_inflate_discoveries(self):
        duplicate = bar()
        duplicate['offers'] += [bar(sourceUrl='other')['offers'][0]]
        result = compare(record([bar()]), record([duplicate]))['categories']['beer']
        self.assertEqual(result['newProducts'], 0)
        self.assertEqual(result['after']['products'], 1)

    def test_removals_and_city_mismatch(self):
        result = compare(record([bar()]), record([]))['categories']['beer']
        self.assertEqual((result['lostPricedVenues'], result['removedProducts']), (1, 1))
        with self.assertRaises(ValueError):
            compare(record([]), {**record([]), 'city': 'bern'})
