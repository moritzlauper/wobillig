import unittest
from scraper.extract import extract_offers
from scraper.pdf_extract import extract_pdf
from scraper.scrape import html_content, scrape_bar
from test_pdf import document

class BeerTypeTests(unittest.TestCase):
    def parse(self,text):return extract_offers(text,'https://example.com/menu','today')

    def test_explicit_kind_never_comes_from_capacity_or_brand(self):
        for line,kind in [('Lager vom Fass 5dl 8.50','draft'),('Lager 50cl Flasche 7.50','bottle'),('Lager offen 3dl 5','draft'),('Lager Dose 33cl 6','can'),('Moretti alla spina 5dl 8','draft'),('Stange 3dl 5','unknown'),('Heineken 33cl 7','unknown'),('Weizen 5dl 9','unknown')]:
            self.assertEqual(self.parse(line)[0]['beerType'],kind,line)

    def test_sections_stop_and_explicit_product_overrides_heading(self):
        found=self.parse('Bier vom Fass\nLager 5dl 8\nWeizen Flasche 5dl 9\nFlaschenbiere\nLager 5dl 7\nAlkoholfreie Biere\nLager alkoholfrei 3dl 5')
        self.assertEqual([o['beerType'] for o in found],['draft','bottle','bottle','unknown'])
        self.assertEqual(self.parse('Bier vom Fass / Flaschenbier\nLager 5dl 7')[0]['beerType'],'unknown')

    def test_same_product_and_price_can_be_both_draft_and_bottle(self):
        found=self.parse('Offenbier\nLager 5dl 8\nFlaschenbier\nLager 5dl 8')
        self.assertEqual({o['beerType'] for o in found},{'draft','bottle'})

    def test_pdf_tables_and_page_context(self):
        body=document([(20,460,'Bier vom Fass'),(220,460,'3dl'),(300,460,'5dl'),(20,440,'Lager'),(220,440,'5.50'),(300,440,'8.00'),(20,410,'Flaschenbier'),(300,410,'50cl'),(20,390,'Weizen'),(300,390,'9.00')])
        found=extract_pdf(body,'url','today')
        self.assertEqual({(o['name'],o['volumeMl'],o['beerType']) for o in found},{('Lager',300,'draft'),('Lager',500,'draft'),('Weizen',500,'bottle')})

    def test_html_label_is_kept_without_renaming_or_duplicates(self):
        html=b'<h2>Offenbier</h2><p>Lager 5dl 8.00</p><h2>Flaschenbier</h2><p>Lager 5dl 8.00</p><h2>Alkoholfreie Biere</h2><p>Lager alkoholfrei 3dl 5</p>'
        class Fetch:
            def get(self,url):return url,'text/html',html
        result=scrape_bar({'id':'node/0','website':'https://example.com','offers':[]},Fetch(),{},1)
        self.assertEqual({(o['name'],o['beerType']) for o in result['offers']},{('Lager','draft'),('Lager','bottle'),('Lager alkoholfrei','unknown')})
        self.assertEqual(len(result['offers']),3)

    def test_bottle_label_after_capacity_is_preserved(self):
        self.assertEqual(self.parse('Weizen 50cl (Flasche) 9')[0]['beerType'],'bottle')
        self.assertEqual(self.parse('Chopfab Draft 33cl 7')[0]['beerType'],'unknown')
        self.assertEqual(self.parse('Flaschenbier\nChopfab Draft 33cl 7')[0]['beerType'],'bottle')

    def test_draft_spelling_and_untyped_new_section(self):
        found=self.parse('FROM T AP (CHOPFAB / BOXER)\nAmber 3dl 6.50\nBELGIAN BEER\nLager 3dl 7')
        self.assertEqual([o['beerType'] for o in found],['draft','unknown'])

    def test_pdf_does_not_borrow_a_heading_from_another_column(self):
        body=document([(350,460,'Flaschenbier'),(20,440,'Lager 5dl 8.00'),(350,420,'Weizen 5dl 9.00')])
        found=extract_pdf(body,'url','today')
        self.assertEqual({(o['name'],o['beerType']) for o in found},{('Lager','unknown'),('Weizen','bottle')})
