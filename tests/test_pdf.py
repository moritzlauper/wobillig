import hashlib
from io import BytesIO
import unittest
from unittest.mock import patch
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from scraper.pdf_extract import extract_pdf, table_lines
from scraper.extract import extract_offers
from scraper.scrape import html_content, scrape_bar, source_allowed


def document(rows):
    """Synthetic menu with independently positioned name, size and price cells."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=500)
    font = DictionaryObject({NameObject('/Type'):NameObject('/Font'), NameObject('/Subtype'):NameObject('/Type1'), NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
    stream = DecodedStreamObject()
    stream.set_data('\n'.join(f'BT /F1 10 Tf {x} {y} Td ({text}) Tj ET' for x,y,text in rows).encode())
    page[NameObject('/Contents')] = writer._add_object(stream)
    output = BytesIO(); writer.write(output)
    return output.getvalue()


class PdfTests(unittest.TestCase):
    def test_fr_currency_for_beer_portions(self):
        found=extract_offers('Lager 3dl Fr. 5.50 / 5dl Fr. 8.00\nStange Fr. 4.50','url','today')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in found],[(300,5.5),(500,8),(None,4.5)])

    def test_price_before_portion_and_printed_unit_punctuation(self):
        text='Boxer Old Lager 5.0 % 6.- / 9.- 0.3 l / 0.5 l\nBoxer Blanche 5.0 % 7.- 0.33 l\nFeldschlösschen 50cl. Fr. 6.50\nAppenzeller Weizen 50cl Bügelflasche 8.00'
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in extract_offers(text,'url','today')],[(300,6),(500,9),(330,7),(500,6.5),(500,8)])
        for bad in ['Boxer Lager 6 / 9 0.5 l','Boxer Lager 6 0.3 l / 0.5 l','Boxer Lager 6 / 9 0.3 l / 0.5 l Happy Hour']:
            self.assertEqual(extract_offers(bad,'url','today'),[],bad)

    def test_standalone_size_row_requires_beer_heading(self):
        body=document([(20,465,'Beer & Cider'),(220,450,'33cl'),(300,450,'50cl'),(20,430,'Lager'),(220,430,'6.80'),(300,430,'8.50'),(20,410,'Weizenbier'),(300,410,'9.00'),(20,390,'Wine'),(220,375,'33cl'),(300,375,'50cl'),(20,355,'Amber'),(300,355,'5.00')])
        offers=extract_pdf(body,'url','today')
        self.assertEqual({(o['name'],o['volumeMl'],o['priceChf']) for o in offers},{('Lager',330,6.8),('Lager',500,8.5),('Weizenbier',500,9)})

    def test_bottle_heading_stops_draught_size_inheritance(self):
        body=document([(20,460,'On Tap'),(220,460,'3dl'),(300,460,'5dl'),(20,440,'Lager'),(220,440,'5.50'),(300,440,'8.00'),(20,420,'By the bottle'),(20,400,'Peroni'),(220,400,'6.50')])
        found=extract_pdf(body,'url','today')
        self.assertEqual({(o['name'],o['volumeMl']) for o in found},{('Lager',300),('Lager',500)})
        for bad in ['Spezi Paulaner 5dl 7.50','Appenzeller Vollmond 6 2.5dl 7','Orangensaft 7 Appenzeller Vollmond 3.3dl 6']:
            self.assertEqual(extract_offers(bad,'url','today'),[])
        self.assertEqual(extract_offers('Bier Paul 01 5.2% 3.3dl 6.50','url','today')[0]['priceChf'],6.5)
        self.assertTrue(extract_offers('Feldschlösschen Alkohol Frei 3dl 5','url','today')[0]['alcoholFree'])
        self.assertEqual(extract_offers('Pale ale | Gluten free URBAN LEMONADE YUZU 3.3dl 7','url','today'),[])

    def test_sparse_header_columns_map_by_position(self):
        body = document([(20,450,'Flaschenbier'),(220,450,'33cl'),(300,450,'50cl'),(20,420,'Amboss Lager'),(220,420,'6.50'),(20,390,'Amboss Weizen'),(300,390,'8.50'),(20,360,'Wein'),(20,330,'Rose'),(220,330,'5.00')])
        offers = extract_pdf(body,'https://example.com/menu.pdf','2026-10-15')
        self.assertEqual({(o['name'],o['volumeMl'],o['priceChf']) for o in offers},{('Amboss Lager',330,6.5),('Amboss Weizen',500,8.5)})

    def test_explicit_portion_overrides_header(self):
        body=document([(20,450,'Bier Flaschen'),(300,450,'33cl'),(20,420,'Weissbier 50cl'),(300,420,'9.00'),(20,390,'Lager'),(300,390,'7.00')])
        offers=extract_pdf(body,'url','today')
        self.assertEqual({(o['volumeMl'],o['priceChf']) for o in offers},{(500,9),(330,7)})

    def test_spaced_pdf_abv_is_not_alcohol_free(self):
        offers=extract_offers('IPA 6. 0 % 33cl 7.50','url','today')
        self.assertEqual(len(offers),1)
        self.assertFalse(offers[0]['alcoholFree'])
        self.assertEqual(offers[0]['name'],'IPA')

    def test_header_units_and_section_boundary(self):
        rows=['Beer','cl CHF','Amboss Lager 33 7.00','Amboss Weizen 50 9.00','Wine','Amber 50 6.00']
        expanded=table_lines([{'text':x,'top':i*15} for i,x in enumerate(rows)])
        offers=[o for line,_ in expanded for o in extract_offers(line,'url','today')]
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(330,7),(500,9)])

    def test_alcohol_free_header_is_inherited(self):
        rows=['Alkoholfreies Bier 30cl 50cl','Erdinger 6.00 8.00']
        expanded=table_lines([{'text':x,'top':i*15} for i,x in enumerate(rows)])
        offers=[o for line,_ in expanded for o in extract_offers(line,'url','today')]
        self.assertEqual(len(offers),2)
        self.assertTrue(all(o['alcoholFree'] for o in offers))

    def test_menu_navigation_includes_embedded_pdf_and_provider(self):
        _,links=html_content(b'<img src="/menu.pdf"><a href="https://api2.lunchgate.ch/menu/abc">Getraenke</a><a href="/gruppenmenu.pdf">Gruppen</a>','https://example.com')
        self.assertIn('https://example.com/menu.pdf',links)
        self.assertIn('https://api2.lunchgate.ch/menu/abc',links)
        self.assertNotIn('https://example.com/gruppenmenu.pdf',links)

    def test_reviewed_prices_require_exact_source_hash(self):
        body=document([(20,450,'Lager 5dl 9.00')]);url='https://example.com/menu.pdf'
        offer={'name':'Lager','volumeMl':500,'priceChf':6,'alcoholFree':False,'evidence':'50cl 6'}
        review={url:{'barId':'node/1','sha256':hashlib.sha256(body).hexdigest(),'exclusive':True,'offers':[offer]}}
        class Fetch:
            def get(self,url):return url,'application/pdf',body
        bar={'id':'node/1','website':url,'offers':[]}
        with patch('scraper.scrape.REVIEWED_MENUS',review):
            found=scrape_bar(bar,Fetch(),{},1)
            self.assertEqual(found['offers'][0]['confidence'],'reviewed')
            self.assertEqual([o['priceChf'] for o in found['offers']],[6])
            review[url]['sha256']='changed'
            result=scrape_bar({**bar,'offers':found['offers']},Fetch(),{},1)
            self.assertEqual(result['offers'],[])
            self.assertEqual(result['scrapeStatus'],'review_required')

    def test_branch_scopes_reject_other_location(self):
        self.assertTrue(source_allowed('node/13878894291','https://hiltl.ch/food-drinks-bistro.pdf'))
        self.assertFalse(source_allowed('node/13878894291','https://hiltl.ch/food-drinks-sihlpost.pdf'))

    def test_abv_after_size_and_zero_brand(self):
        offers=extract_offers('Pilsner Urquell 50cl 4.4% 9.50\nBirra Moretti Zero 33cl 7\nErdinger 0.0 33cl 6','url','today')
        self.assertEqual(len(offers),3)
        self.assertEqual([o['alcoholFree'] for o in offers],[False,True,True])
        self.assertEqual(offers[0]['priceChf'],9.5)

    def test_shared_unit_does_not_consume_previous_price(self):
        offers=extract_offers('Lager 33cl 6.5 / 50cl 9.9\nPils 0.2/0.4l 4.5/8.5','url','today')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(330,6.5),(500,9.9),(200,4.5),(400,8.5)])
