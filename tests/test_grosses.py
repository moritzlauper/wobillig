"""Regressions for generic beer portions and unequal folded menu columns."""
import unittest
from scraper.extract import extract_offers
from scraper.pdf_extract import extract_pdf, column_regions, table_lines
from test_pdf import document
from io import BytesIO
import pdfplumber


class GrossesTests(unittest.TestCase):
    def test_generic_portions_require_beer_context_and_printed_size(self):
        for label in ['GROSSES', 'Grosses', 'Großes', 'es Grosses', 'Herrgöttli']:
            offers = extract_offers('BIER\n' + label + ' 5dl 7.50', 'url', 'today')
            self.assertEqual([(o['name'], o['volumeMl'], o['priceChf']) for o in offers], [(label, 500, 7.5)])
            self.assertEqual(offers[0]['beerType'], 'unknown')
            self.assertEqual(extract_offers(label + ' 5dl 7.50', 'url', 'today'), [])
            self.assertEqual(extract_offers('BIER\n' + label + ' 7.50', 'url', 'today'), [])
        self.assertEqual(extract_offers('BIER\nGrosses Wasser 5dl 4.50', 'url', 'today'), [])

    def test_other_drinks_end_beer_context(self):
        for heading in ['SOFTDRINKS', 'WEISSWEIN', 'ROTWEIN', 'APERITIF', 'SPIRITUOSEN', 'KAFFEE']:
            self.assertEqual(extract_offers('BIER\n' + heading + '\nGrosses 5dl 4.50', 'url', 'today'), [])
        self.assertEqual(extract_offers('WEISSWEIN\nMYTHOS 1dl 6.50', 'url', 'today'), [])

    def test_explicit_draft_and_parallel_sizes(self):
        found = extract_offers('BIER VOM FASS\nGrosses 3dl / 5dl 5.50 / 7.50', 'url', 'today')
        self.assertEqual([(o['volumeMl'], o['priceChf'], o['beerType']) for o in found], [(300, 5.5, 'draft'), (500, 7.5, 'draft')])

    def test_contextual_table_portion(self):
        rows = [{'text': t, 'top': i*15} for i,t in enumerate(['BIER 3dl 5dl', 'Grosses 5.50 7.50'])]
        expanded = table_lines(rows)
        found = [o for line, evidence in expanded for o in extract_offers(evidence.split(' / ')[0] + '\n' + line, 'url', 'today')]
        self.assertEqual([(o['volumeMl'], o['priceChf']) for o in found], [(300, 5.5), (500, 7.5)])

    def test_subtitle_and_alcohol_free_qualifier(self):
        body = document([(20,470,'BIER'), (20,440,'GROSSES 5dl 7.50'), (20,426,'Lager'),
                         (20,400,'Heineken 3.3dl 5.-'), (20,388,'ALKOHOLFREI')])
        found = extract_pdf(body, 'url', 'today')
        self.assertEqual([(o['name'], o['volumeMl'], o['priceChf'], o['alcoholFree']) for o in found],
                         [('GROSSES Lager', 500, 7.5, False), ('Heineken ALKOHOLFREI', 330, 5, True)])
        self.assertIn('GROSSES 5dl 7.50 / Lager', found[0]['evidence'])

    def test_subtitle_cannot_consume_next_product_with_own_portion(self):
        body = document([(20,470,'BIER'), (20,440,'GROSSES 5dl 7.50'), (20,426,'Lager'), (20,412,'3dl 5.00')])
        found = extract_pdf(body, 'url', 'today')
        self.assertIn(('GROSSES', 500, 7.5), [(o['name'],o['volumeMl'],o['priceChf']) for o in found])
        self.assertNotIn('GROSSES Lager', [o['name'] for o in found])

    def test_unequal_columns_with_duplicate_heading_and_prose(self):
        rows = [(20,470,'WEIN'), (20,440,'Mythos 1dl 6.50'),
                (20,420,'Moschofilero Moscato'), (20,400,'Peloponnese Greece'),
                (20,380,'Weisswein Hauswein'), (20,360,'Rotwein Rose'),
                (180,470,'BIER'), (180,470,'BIER'), (180,440,'GROSSES'), (245,440,'5dl'), (275,440,'7.50'),
                (180,426,'Lager'), (180,400,'STANGE 3dl 5.50'), (180,380,'Heineken 33cl 5.50'),
                (180,350,'APERITIF'), (180,330,'Aperol Spritz 11.50'), (180,310,'Hugo Prosecco'),
                (350,440,'Restaurant mit langer Geschichte'), (350,420,'Frische regionale Zutaten'),
                (350,400,'Freundliche Gastgeber freuen sich auf Sie')]
        found = extract_pdf(document(rows), 'url', 'today')
        self.assertIn(('GROSSES Lager', 500, 7.5), [(o['name'],o['volumeMl'],o['priceChf']) for o in found])
        self.assertFalse(any(o['volumeMl'] == 100 for o in found))
        self.assertEqual(len([o for o in found if o.get('serving') == 'stange']), 1)

    def test_never_split_price_columns(self):
        body = document([(20,470,'BIER'), (20,440,'Lager'), (220,440,'5dl'), (300,440,'7.50'),
                         (20,420,'Heineken'), (220,420,'3dl'), (300,420,'5.50')])
        with pdfplumber.open(BytesIO(body)) as doc:
            self.assertEqual(len(column_regions(doc.pages[0])), 1)
