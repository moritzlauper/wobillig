import unittest
from scraper.locations import catalogue


class LocationCatalogueTests(unittest.TestCase):
    def test_canonical_ids_and_metadata_win_without_prices(self):
        found = {'discoveredAt': '2026-10-15', 'bars': [
            {'id': 'node/1', 'name': 'Old', 'cuisine': ['pizza'], 'offers': []},
            {'id': 'node/2', 'name': 'New', 'offers': []}]}
        existing = [{'id': 'node/1', 'name': 'Updated', 'offers': [{'priceChf': 5}], 'checkedAt': 'yesterday'}]
        output = catalogue(found, existing)
        self.assertEqual(len(output['bars']), 2)
        self.assertTrue(all(not b['offers'] and b['checkedAt'] is None for b in output['bars']))
        self.assertEqual(next(b['name'] for b in output['bars'] if b['id'] == 'node/1'), 'Updated')
        self.assertEqual(output['discoveredAt'], '2026-10-15')
        self.assertEqual(next(b for b in output['bars'] if b['id'] == 'node/1')['cuisine'], ['pizza'])
        self.assertEqual(existing[0]['offers'], [{'priceChf': 5}])
