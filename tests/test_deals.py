import unittest
from datetime import date
from unittest.mock import MagicMock, patch
from scraper.deals import parse_pdf, branch_candidates, money
from scraper.coop_wine import brochure_match, brochure_money, build, parse_tile


class DealTests(unittest.TestCase):
    def test_money_and_candidates(self):
        self.assertEqual(money('–.80'), .8)
        self.assertEqual(money('9.–'), 9)
        self.assertEqual(branch_candidates([{'properties': {'name': 'Coop Vitality', 'osm_key': 'amenity'}}]), [])

    def test_extracts_only_unambiguous_five_offer_layout(self):
        page = MagicMock(width=595.276, height=841.89)
        page.extract_text.return_value = 'Donnerstag bis Mittwoch, 15.10. – 21.10.2026 ' + 'statt ' * 5
        texts = ['50%\n9.–\nstatt 18.–', 'Coop Testzucker, 10 × 1 kg'] * 5
        page.crop.side_effect = [MagicMock(extract_text=MagicMock(return_value=text)) for text in texts]
        document = MagicMock()
        document.__enter__.return_value.pages = [page]
        with patch('scraper.deals.pdfplumber.open', return_value=document):
            batch = parse_pdf(b'pdf', 'https://epaper.coop.ch/test.pdf', '2026-10-20T12:00:00Z')
        self.assertEqual(len(batch['offers']), 5)
        self.assertEqual(batch['offers'][0]['validThrough'], '2026-10-21')
        self.assertEqual(batch['offers'][0]['unitPrice'], {'amount': .9, 'unit': 'kg'})
        self.assertEqual(batch['branches'], [])

    def test_changed_layout_fails_closed(self):
        page = MagicMock(width=595.276, height=841.89)
        page.extract_text.return_value = 'Gültig diese Woche'
        document = MagicMock()
        document.__enter__.return_value.pages = [page]
        with patch('scraper.deals.pdfplumber.open', return_value=document):
            with self.assertRaises(ValueError):
                parse_pdf(b'pdf', 'https://epaper.coop.ch/test.pdf', '2026-10-20T12:00:00Z')


TILE = {'id': '1000706021', 'path': '/de/weine/alle-weine/rotweine/rioja-doca-crianza-cune/p/1000706021', 'cat': 'rotweine',
        'label': 'Rioja DOCa Crianza Cune 34% Aktion 7.85 CHF statt 11.95 CHF',
        'lines': ['75cl', 'Rioja DOCa Crianza Cune', 'Spanien, 2022', 'Rated of 5', '(271)', '34%', '34%',
                  'CHF 7.85 statt CHF 11.95', '7.85', '11.95', 'Preis pro 10 Zentiliter', '1.05/10cl', '(6)']}


class CoopWineTests(unittest.TestCase):
    def test_tile_uses_printed_prices_only(self):
        offer, reason = parse_tile(TILE)
        self.assertIsNone(reason)
        self.assertEqual((offer['priceChf'], offer['previousPriceChf'], offer['quantity']), (7.85, 11.95, '75 cl'))
        self.assertEqual((offer['wineType'], offer['origin'], offer['unitPrice']), ('red', 'Spanien, 2022', {'amount': 10.5, 'unit': 'l'}))
        bundle = {**TILE, 'label': 'Rioja DOCa Las Flores Online 40% ab 6 Aktion 8.95 CHF', 'lines': ['75cl', 'Rioja DOCa Las Flores', 'Online', 'CHF 8.95', '1.19/10cl']}
        self.assertEqual(parse_tile(bundle), (None, 'Kein Statt-Preis'))
        wrong_size = {**TILE, 'lines': [line if line != '75cl' else '50cl' for line in TILE['lines']]}
        self.assertEqual(parse_tile(wrong_size)[1], 'Literpreis passt nicht zur Menge')

    def test_brochure_match_needs_same_price_pair_or_brand_discount(self):
        self.assertEqual((brochure_money(51), brochure_money(.95)), ('51.–', '–.95'))
        word = lambda text, x, top: {'text': text, 'x0': x, 'x1': x + 5 * len(text), 'top': top}
        page = {'url': 'https://epaper.coop.ch/p12.pdf', 'number': 12,
                'text': 'Malbec Mendoza Loco Selection 9.70 statt 14.95\n40% auf alle Coppola Weine',
                'words': [word('9.70', 100, 100), word('statt', 100, 130), word('14.95', 130, 130), word('40%', 400, 100), word('Coppola', 390, 160)]}
        main = (date(2026, 10, 22), date(2026, 10, 28))
        found, validity = brochure_match({'product': 'Loco Malbec Mendoza Selection', 'priceChf': 9.7, 'previousPriceChf': 14.95, 'discount': 35}, [page], main)
        self.assertEqual((found['number'], validity[1:]), (12, main))
        self.assertEqual(brochure_match({'product': 'Chardonnay Diamond Coppola', 'priceChf': 11.7, 'previousPriceChf': 19.5, 'discount': 40}, [page], main)[0]['number'], 12)
        self.assertIsNone(brochure_match({'product': 'Chardonnay Diamond Coppola', 'priceChf': 15.6, 'previousPriceChf': 19.5, 'discount': 20}, [page], main)[0])
        self.assertIsNone(brochure_match({'product': 'Verdejo Nebla', 'priceChf': 9.7, 'previousPriceChf': 14.95, 'discount': 35}, [page], main)[0])

    def test_build_marks_unknown_end_and_keeps_city_branches_only(self):
        stores = {'1905': {'title': 'Coop Supermarkt Zürich Bahnhofbrücke', 'street': 'Bahnhofbrücke 1', 'zip': '8001', 'city': 'Zürich',
                           'lat': '47.3767', 'lon': '8.5421', 'link': '/de/standorte/coop-supermarkt-zuerich-bahnhofbruecke/1905_POS'},
                  '2001': {'title': 'Coop Supermarkt Zollikon', 'street': 'Dorfstrasse 1', 'zip': '8702', 'city': 'Zollikon',
                           'lat': '47.34', 'lon': '8.57', 'link': '/de/standorte/coop-supermarkt-zollikon/2001_POS'}}
        raw = {'startedAt': '2026-10-26T16:00:00Z', 'pages': {'1': [TILE]}, 'stores': stores, 'avail': {'1000706021': {'ids': ['1905', '2001']}}}
        batch, skipped = build(raw, [], 'c' * 64)
        offer = batch['offers'][0]
        self.assertEqual((offer['validFrom'], offer['validThrough'], offer['endUnknown']), ('2026-10-26', '2026-10-26', True))
        self.assertEqual(offer['availableAt'], ['coop/1905'])
        self.assertEqual([b['id'] for b in batch['branches']], ['coop/1905'])
        self.assertEqual(skipped, {})
