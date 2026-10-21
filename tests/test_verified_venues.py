import copy
import unittest

from scraper.locations import catalogue
from scraper.verified_venues import include_verified_coffee_venues


class VerifiedVenueTests(unittest.TestCase):
    def test_rondell_refresh_keeps_identity_prices_and_observation_date(self):
        source = {'discoveredAt': 'old-discovery', 'bars': [{
            'id': 'node/5733725990', 'name': 'Mensa UZH Zentrum (Lichthof Rondell)',
            'type': 'fast_food', 'openingHours': 'closed for renovation',
            'offers': [{'priceChf': 4.5, 'observedAt': 'original-date'}],
            'checkedAt': 'original-check', 'scrapeStatus': 'ok',
        }]}
        original = copy.deepcopy(source)
        updated = include_verified_coffee_venues(source, 'zurich')
        rondell = [b for b in updated['bars'] if 'Rondell' in b['name']]
        self.assertEqual(len(rondell), 1)
        self.assertEqual(rondell[0]['id'], 'node/5733725990')
        self.assertIn('UZH Hauptgebäude', rondell[0]['name'])
        self.assertEqual(rondell[0]['type'], 'cafe')
        self.assertEqual(rondell[0]['openingHours'], 'Mo-Fr 07:30-16:30')
        self.assertEqual(rondell[0]['offers'], original['bars'][0]['offers'])
        self.assertEqual(rondell[0]['checkedAt'], 'original-check')
        self.assertEqual(updated['discoveredAt'], 'old-discovery')
        self.assertEqual(source, original)
        self.assertEqual(include_verified_coffee_venues(updated, 'zurich'), updated)

    def test_new_locations_have_no_invented_prices_and_stay_in_their_city(self):
        empty = {'bars': []}
        zurich = include_verified_coffee_venues(empty, 'zurich')['bars']
        self.assertTrue(all(b['offers'] == [] and b['checkedAt'] is None for b in zurich))
        self.assertTrue(any(b['id'] == 'verified/vicafe-campus-irchel' for b in zurich))
        self.assertFalse(any('François' in b['name'] for b in zurich))
        lausanne = include_verified_coffee_venues(empty, 'lausanne')['bars']
        self.assertEqual([b['name'] for b in lausanne], ['ViCAFE St. François'])
        self.assertEqual(include_verified_coffee_venues(empty, 'bern'), empty)

    def test_location_catalogue_clears_prices_and_retains_verified_metadata(self):
        stale = {'bars': [{'id': 'node/5733725990', 'name': 'Mensa',
                          'offers': [{'priceChf': 4.5}]}]}
        output = catalogue(include_verified_coffee_venues(catalogue(stale, []), 'zurich'), [])
        self.assertTrue(all(b['offers'] == [] and b['checkedAt'] is None
                            and b['scrapeStatus'] == 'location_only' for b in output['bars']))
        rondell = next(b for b in output['bars'] if b['id'] == 'node/5733725990')
        self.assertEqual(rondell['address'], 'Rämistrasse 71')
        self.assertIn('ViCAFE', rondell['name'])
