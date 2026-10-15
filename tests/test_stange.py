import unittest
from scraper.extract import extract_offers, extract_stange_prefix
from scraper.scrape import html_content
from scraper.pdf_extract import extract_pdf
from test_pdf import document

class StangeTests(unittest.TestCase):
    def parse(self,text):return extract_offers(text,'https://example.com/menu','2026-10-15')

    def test_explicit_sizes_are_preserved(self):
        for text,size in [('Stange 3dl 5.50',300),('Stange Hopfenperle 4.8% 3.0 dl 5.50',300),('Stange 33cl 5.30',330)]:
            offer=self.parse(text)[0]
            self.assertEqual(offer['volumeMl'],size)
            self.assertEqual(offer['serving'],'stange')

    def test_named_serving_without_size_never_assumes_volume(self):
        for text in ['Stange 5.-','Calanda Stange CHF 5.00','Stange 5 CHF']:
            offer=self.parse(text)[0]
            self.assertIsNone(offer['volumeMl'])
            self.assertEqual(offer['priceChf'],5)
            self.assertEqual(offer['evidence'],text)
            self.assertEqual(offer['serving'],'stange')

    def test_supplements_food_large_and_conditional_offers_rejected(self):
        for text in ['Sellerie Stange 3.50','Salzstange 3.50','Grosse Stange 8.00','Stange Gross 8.00','Happy Hour Stange 4.00','Stange 5.00 / 7.50','Stange 0ml 5.00','Picon Bière Stange mit 2cl Picon 30cl 7.50']:
            self.assertEqual(self.parse(text),[],text)

    def test_serving_labels_after_volume(self):
        self.assertEqual(self.parse('Quöllfrisch offen 30cl «Stange» 4.80')[0]['volumeMl'],300)
        offers=self.parse('Appenzeller Quöllfrisch 30cl/45cl offen 5.50/7.50')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(300,5.5),(450,7.5)])

    def test_html_adjacent_price_and_pdf_row(self):
        text,_=html_content(b'<div><p>Stange</p><div>CHF 4.50</div></div>','https://example.com')
        offers=self.parse(text)
        self.assertTrue(any(o['volumeMl'] is None and o['priceChf']==4.5 for o in offers))
        offers=extract_pdf(document([(20,450,'Stange'),(220,450,'3dl'),(300,450,'5.50')]),'https://example.com/menu.pdf','2026-10-15')
        self.assertTrue(any(o['volumeMl']==300 and o['priceChf']==5.5 for o in offers))

    def test_pdf_second_column_cannot_supply_the_stange_price(self):
        for text,price in [('Stange medium vom Fass 3 dl 4.80 Cognac und Brandy',4.8),('Quöllfrisch offen 30cl «Stange» 4.80 Martini 4cl 8.50',4.8),('Stange 3dl 5.8 Grosses Bier 5dl 8.6',5.8)]:
            offers=extract_stange_prefix(text,'url','today')
            self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(300,price)])
        for text in ['Stange 3dl Cola 5dl 4.50','Picon Bière Stange mit 2cl Picon 30cl 7.50','Stange 3dl 5.5o Grosses 5dl 8']:
            self.assertEqual(extract_stange_prefix(text,'url','today'),[])

    def test_non_alcoholic_section_applies_to_pdf_stange_prefix(self):
        body=document([(20,450,'ALKOHOLFREIES BIER'),(20,420,'Stange 3dl 5.50 Cocktails')])
        offers=extract_pdf(body,'url','today')
        self.assertTrue(offers)
        self.assertTrue(all(o['alcoholFree'] for o in offers))
