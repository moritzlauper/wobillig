import unittest
from unittest.mock import MagicMock, patch
from scraper.deals import parse_pdf, branch_candidates, money


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
