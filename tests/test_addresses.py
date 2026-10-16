import unittest
from unittest.mock import patch, Mock

from scraper.addresses import AddressLookup, enrich, tag_address
from scraper.scrape import discover


def building(id=1, **tags):
    return {'type': 'way', 'id': id, 'tags': {'building': 'yes', **tags},
            'geometry': [{'lon': x, 'lat': y} for x, y in [(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)]]}


def entrance(id=2, lon=0, **tags):
    return {'type': 'node', 'id': id, 'lon': lon, 'lat': 1,
            'tags': {'addr:street': 'Testgasse', 'addr:housenumber': '4', 'addr:postcode': '3011', **tags}}


VENUE = {'id': 'node/10', 'lat': 1, 'lon': 1, 'address': '', 'postcode': ''}


class AddressTests(unittest.TestCase):
    def test_contact_addresses_and_standard_tag_priority(self):
        for key in ('contact:addr', 'contact:addr:full', 'addr:full'):
            self.assertEqual(tag_address({key: 'Breitenrainplatz 40, 3014 Bern'}),
                             {'address': 'Breitenrainplatz 40', 'postcode': '3014'})
        self.assertEqual(tag_address({'contact:street': 'Testgasse', 'contact:housenumber': '4', 'contact:postcode': '3011'})['address'], 'Testgasse 4')
        self.assertEqual(tag_address({'addr:street': 'Neu', 'addr:housenumber': '1', 'contact:addr': 'Alt 2, 3011 Bern'})['address'], 'Neu 1')
        self.assertEqual(tag_address({'contact:addr': 'Bern'})['address'], '')
        self.assertEqual(tag_address({'addr:place': 'Hirschengraben', 'addr:housenumber': '10'})['address'], 'Hirschengraben 10')

    def test_unambiguous_building_entrance_and_provenance(self):
        result = AddressLookup([building(), entrance()]).lookup(VENUE)
        self.assertEqual(result['address'], 'Testgasse 4')
        self.assertEqual(result['postcode'], '3011')
        self.assertEqual(result['addressSource'], 'https://www.openstreetmap.org/node/2')

    def test_ambiguous_or_nearby_buildings_are_not_guessed(self):
        lookup = AddressLookup([building(), entrance(), entrance(3, lon=2, **{'addr:housenumber': '6'})])
        self.assertIsNone(lookup.lookup(VENUE))
        self.assertIsNone(AddressLookup([building(), entrance()]).lookup({**VENUE, 'lon': 2.1}))

    def test_another_business_is_not_a_building_address(self):
        self.assertIsNone(AddressLookup([building(), entrance(amenity='restaurant')]).lookup(VENUE))
        self.assertIsNone(AddressLookup([building(), entrance(), entrance(3, lon=1, amenity='restaurant', **{'addr:housenumber': '8'})]).lookup(VENUE))

    def test_direct_address_wins_over_building(self):
        direct = {'type': 'node', 'id': 10, 'tags': {'contact:addr': 'Eigene Gasse 9, 3014 Bern'}}
        self.assertEqual(AddressLookup([building(), entrance(), direct]).lookup(VENUE)['address'], 'Eigene Gasse 9')

    def test_enrichment_updates_every_category_without_touching_prices(self):
        datasets = [{'bars': [{**VENUE, 'offers': [{'priceChf': 4.4}]}]},
                    {'bars': [{**VENUE, 'address': 'Geprüfte Gasse 8', 'postcode': '3014', 'offers': []}]}]
        enrich(datasets, AddressLookup([building(), entrance()]))
        self.assertTrue(all(d['bars'][0]['address'] == 'Geprüfte Gasse 8' for d in datasets))
        self.assertEqual(datasets[0]['bars'][0]['offers'], [{'priceChf': 4.4}])

    def test_reviewed_address_fills_missing_values_before_building_inference(self):
        datasets = [{'bars': [{**VENUE}]}]
        reviewed = {VENUE['id']: {'address': 'Eigener Eingang 8', 'postcode': '3014', 'addressSource': 'https://example.com/kontakt'}}
        enrich(datasets, AddressLookup([building(), entrance()]), reviewed)
        self.assertEqual(datasets[0]['bars'][0]['address'], 'Eigener Eingang 8')

    def test_house_number_without_street_is_completed(self):
        datasets = [{'bars': [{**VENUE, 'address': '10'}]}]
        node = {'type': 'node', 'id': 10, 'tags': {'addr:place': 'Hirschengraben', 'addr:housenumber': '10'}}
        enrich(datasets, AddressLookup([node]))
        self.assertEqual(datasets[0]['bars'][0]['address'], 'Hirschengraben 10')

    def test_discovery_retains_enriched_address_when_osm_poi_has_none(self):
        old = {**VENUE, 'name': 'Test', 'type': 'cafe', 'address': 'Testgasse 4', 'postcode': '3011',
               'addressSource': 'https://www.openstreetmap.org/node/2'}
        response = Mock()
        response.json.return_value = {'elements': [{'type': 'node', 'id': 10, 'lat': 1, 'lon': 1, 'tags': {'name': 'Test'}}]}
        with patch('scraper.scrape.requests.get', return_value=response):
            result = discover({'bars': [old]})['bars'][0]
        self.assertEqual(result['address'], old['address'])
        self.assertEqual(result['addressSource'], old['addressSource'])


if __name__ == '__main__':
    unittest.main()
