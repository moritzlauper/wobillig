import unittest
from scraper.outdoor_permits import apply, current_permits, match, permit_name, permit_terms, similarity, summary


def row(id, text, lat=47.5565, lon=7.5923, decision='bewilligt', start='2020-01-01', end='2099-12-31'):
    return {'begehrenid': id, 'bezeichng': text, 'entsch_bez': decision, 'datum_von': start, 'datum_bis': end,
            'geo_point_2d': {'lat': lat, 'lon': lon}}


class OutdoorPermitTests(unittest.TestCase):
    def test_reads_name_season_and_area_from_the_permit_text(self):
        self.assertEqual(permit_name('Boulevardrestaurant PERRON  Fläche: 15 m2  Saisonbewilligung 15.02.-15.11.'), 'PERRON')
        self.assertEqual(permit_name('Boulevardrestaurant VITO (Erweiterung)  Fläche 8m2'), 'VITO')
        self.assertEqual(permit_name('Erweiterung Boulevardrestaurant HANS IM GLÜCK  Fläche 5 m2'), 'HANS IM GLÜCK')
        self.assertIsNone(permit_name('Antrag zur Nutzung eines Boulevardrestaurant'))
        self.assertEqual(permit_terms('Boulevardrestaurant A  Saisonbewilligung jeweils vom 15.2. bis 15.11.  Fläche 38m?'),
                         {'season': 'seasonal', 'from': '02-15', 'until': '11-15', 'areaM2': 38.0})
        self.assertEqual(permit_terms('Boulevardrestaurant B  Ganzjahresbewilligung  Fläche 7.30m2'), {'season': 'year', 'areaM2': 7.3})
        # A start date alone is no season.
        self.assertEqual(permit_terms('Boulevardrestaurant C  Rückwirkend per 07.10.2026'), {'season': 'unspecified'})

    def test_keeps_only_approved_permits_valid_today_and_groups_their_areas(self):
        rows = [row(1, 'Boulevardrestaurant A  Fläche 5 m2'), row(1, 'Boulevardrestaurant A  Fläche 5 m2', lat=47.5566),
                row(2, 'Boulevardrestaurant B', decision='abgelehnt'), row(3, 'Boulevardrestaurant C', end='2026-01-01'),
                row(4, 'Boulevardrestaurant D', start='2027-01-01'), row(5, 'Antrag zur Nutzung eines Boulevardrestaurant')]
        permits = current_permits(rows, '2026-10-19')
        self.assertEqual([(p['id'], p['name'], len(p['points'])) for p in permits], [('1', 'A', 2)])

    def test_assigns_only_clear_names_close_to_the_venue(self):
        self.assertEqual(similarity('KURT & KLÄRLI', 'Kurt + Klärli', 5), 1)
        self.assertEqual(similarity('MANA BAR', 'ManaBar', 3), 1)
        self.assertEqual(similarity('IRISH PUB PADDY REILLYS', "Paddy Reilly's Irish Pub & Restaurant", 10), 1)
        self.assertGreaterEqual(similarity('NEGISHI SUSHI BAR', 'Negishi', 4), .85)
        self.assertGreaterEqual(similarity('PIZZERIA PICASSO', 'Pizza Picassso', 4), .85)
        self.assertEqual(similarity('BREITE GRILL', 'Multi Grill', 5), 0)
        self.assertEqual(similarity('THE PUB', 'Pub', 5), 0)
        venues = [{'id': 'node/1', 'name': 'Hostaria', 'lat': 47.5565, 'lon': 7.5924},
                  {'id': 'node/2', 'name': 'Hostaria', 'lat': 47.5600, 'lon': 7.5923},  # 390 m away
                  {'id': 'node/3', 'name': 'Bar Amber', 'lat': 47.5565, 'lon': 7.5923}]
        permits = current_permits([row(1, 'Boulevardrestaurant HOSTARIA  Fläche 8m2'), row(2, 'Boulevardrestaurant ZUM ADLER')], '2026-10-19')
        self.assertEqual({k: [p['id'] for p in v] for k, v in match(permits, venues).items()}, {'node/1': ['1']})

    def test_publishes_one_summary_per_venue_and_removes_stale_permits(self):
        year = {'id': '1', 'name': 'A', 'season': 'year', 'areaM2': 10.0}
        seasonal = {'id': '2', 'name': 'A', 'season': 'seasonal', 'from': '02-15', 'until': '11-15', 'areaM2': 5.5}
        self.assertEqual(summary([year, seasonal]), {'season': 'year', 'areaM2': 15.5, 'permitIds': ['1', '2'], 'permitNames': ['A']})
        self.assertEqual(summary([seasonal])['until'], '11-15')
        dataset = {'bars': [{'id': 'node/1'}, {'id': 'node/2', 'outdoorPermit': {'season': 'year'}}]}
        self.assertTrue(apply(dataset, {'node/1': summary([seasonal])}))
        self.assertEqual(dataset['bars'], [
            {'id': 'node/1', 'outdoorPermit': {'season': 'seasonal', 'from': '02-15', 'until': '11-15', 'areaM2': 5.5}},
            {'id': 'node/2'}])
        self.assertFalse(apply(dataset, {'node/1': summary([seasonal])}))


if __name__ == '__main__':
    unittest.main()
