import json
from pathlib import Path
import tempfile
import unittest
import hashlib
from unittest.mock import patch
from scraper.coffee import extract_coffees, coffee_pdf, coffee_types, coffee_row_columns
from scraper.scrape import html_content, scrape_bar, source_allowed, prioritize_links
from scraper.scrape_coffee import ArchiveFetcher, select_venues
from test_pdf import document


class CoffeeTests(unittest.TestCase):
    def parse(self, text):
        return extract_coffees(text, 'https://example.com/menu', '2026-10-15')

    def test_shared_price_and_no_invented_volume(self):
        offers=self.parse('Kaffee / Espresso / Ristretto CHF 4.50')
        self.assertEqual({o['coffeeType'] for o in offers}, {'creme','espresso','ristretto'})
        self.assertTrue(all(o['priceChf']==4.5 and o['volumeMl'] is None for o in offers))
        self.assertEqual(self.parse('Kaffee 4.50')[0]['name'], 'Kaffee')
        self.assertEqual(self.parse('Kaffee Espresso 4.50'), [])

    def test_double_and_milk_coffees_keep_their_category(self):
        for text in ['Doppio Espresso 6.50', 'Espresso doppio 6.50', 'Doppelter Espresso 6.50']:
            self.assertEqual([(o['coffeeType'],o['priceChf']) for o in self.parse(text)], [('double',6.5)])
        self.assertEqual(coffee_types('Caffè Latte'), ['milk'])
        self.assertEqual(coffee_types('Latte Macchiato'), ['latte'])
        self.assertEqual(coffee_types('Milchkaffee «Schale»'), ['milk'])

    def test_explicit_alternative_prices_keep_printed_order(self):
        self.assertEqual([(o['coffeeType'],o['priceChf']) for o in self.parse('Espresso / Doppio 4.70 / 5.70')], [('espresso',4.7),('double',5.7)])
        for line in ['Espresso / Doppio 4.70 5.70', 'Espresso 4.70 / 5.70', 'Espresso / Doppio / Cappuccino 4.70 / 5.70']:
            self.assertEqual(self.parse(line), [], line)

    def test_matcha_drinks_keep_their_category(self):
        for name,kind in [('Matcha Latte','matcha_latte'),('Matcha-Latte','matcha_latte')]:
            self.assertEqual([(o['coffeeType'],o['priceChf']) for o in self.parse(name+' 6.50')],[(kind,6.5)])
        for line in ['Matcha 5.50','Matcha Tee 5.50','Matcha Tea 5.50','Matcha Kuchen 6.50','Matcha Martini 12','Extra Matcha 2','Iced Matcha Latte 7']:
            self.assertEqual(self.parse(line),[],line)

    def test_matcha_only_pdf_page_is_extracted(self):
        body=document([(20,450,'Matcha 5.50'),(20,420,'Matcha Latte 6.50')])
        offers=coffee_pdf(body,'https://example.com/menu.pdf','2026-10-15')
        self.assertEqual({(o['coffeeType'],o['priceChf']) for o in offers},{('matcha_latte',6.5)})

    def test_supplements_cocktails_iced_and_combos_are_not_standard_coffee(self):
        for line in ['Extra Espresso 2.00', '+ Espresso 2.00', 'Espresso Martini 12', 'Kafi Luz 6.50', 'Iced Cappuccino 6', 'Cappuccino auf Eis 5.50', 'Gipfeli und Kaffee 5', 'Espresso oder Kaffee zum Menü 3.50', 'CAPPUCCINO. 2']:
            self.assertEqual(self.parse(line), [], line)
        self.assertEqual(self.parse('Cappuccino (doppio) / Flat White 6.50'),[])

    def test_currency_leaders_and_spaced_decimal(self):
        self.assertEqual(self.parse('Café crème ........ 4 .90')[0]['priceChf'],4.9)
        self.assertEqual(self.parse('Espresso 4.–')[0]['priceChf'],4)
        self.assertEqual(self.parse('Cappuccino 5,50 CHF')[0]['priceChf'],5.5)

    def test_swiss_currency_and_explicit_label_formats(self):
        for line in ['Espresso Fr. 4.50', 'Fr. 4.50 Espresso', 'Espresso 4. 50', 'Espresso* 4.50']:
            self.assertEqual([(o['coffeeType'],o['priceChf']) for o in self.parse(line)],[('espresso',4.5)],line)
        self.assertEqual(self.parse('Cappuccino (3dl) 5.50')[0]['volumeMl'],None)
        self.assertEqual(coffee_types('Doppel-Espresso'),['double'])
        self.assertEqual(coffee_types('Caffè Americano'),['americano'])
        self.assertEqual({o['coffeeType'] for o in self.parse('Kaffee / Espresso / Tee 5.00')},{'creme','espresso'})
        for line in ['Kaffee mit Tee 5', 'Fr. 4.50 Extra Espresso', 'Espresso / Kuchen 5']:
            self.assertEqual(self.parse(line),[])

    def test_pdf_local_columns_keep_prices_with_their_labels(self):
        body=document([(20,450,'Espresso'),(150,450,'4.50'),(320,450,'Cappuccino'),(460,450,'6.20'),(20,420,'Flat White'),(320,420,'Latte Macchiato'),(460,420,'6.80')])
        found=coffee_pdf(body,'https://example.com/menu.pdf','today')
        self.assertEqual({(o['coffeeType'],o['priceChf']) for o in found},{('espresso',4.5),('cappuccino',6.2),('latte',6.8)})

    def test_raised_cents_require_smaller_and_raised_type(self):
        def char(text,x,size,top):
            return {'text':text,'x0':x,'x1':x+5,'size':size,'top':top,'bottom':top+size}
        chars=[char('5',100,17,10),char('5',105,9,10),char('0',110,9,10)]
        self.assertIn('5.50',coffee_row_columns({'chars':chars}))
        # Plain three-digit values and duplicate glyphs must not become prices.
        self.assertNotIn('5.50',coffee_row_columns({'chars':[{**c,'size':17,'bottom':27} for c in chars]}))
        self.assertEqual(coffee_row_columns({'chars':chars+chars}),['5.50'])

    def test_raised_cents_with_narrow_font_spacing_glyph(self):
        def char(text,x,width,size,top):
            return {'text':text,'x0':x,'x1':x+width,'size':size,'top':top,'bottom':top+size}
        chars=[char('4',100,6,15,10),char('!',106,1,15,10),char('8',107,4,8.7,9.5),char('0',111,4,8.7,9.5)]
        self.assertEqual(coffee_row_columns({'chars':chars}),['4.80'])
        self.assertNotIn('4.80',coffee_row_columns({'chars':[{**c,'size':15,'bottom':25} for c in chars]}))
        self.assertEqual(self.parse('Espresso 4!80'),[])

    def test_pdf_raised_price_on_separate_baseline_stays_with_its_row(self):
        from io import BytesIO
        from pypdf import PdfReader, PdfWriter
        body=document([(20,450,'Espresso'),(400,453,'4'),(406,456,'80'),
                       (20,400,'Cappuccino'),(400,380,'6.50')])
        page=PdfReader(BytesIO(body)).pages[0]
        stream=page['/Contents'].get_object()
        stream.set_data(stream.get_data().replace(b'/F1 10 Tf 406',b'/F1 6 Tf 406'))
        writer=PdfWriter();writer.add_page(page)
        output=BytesIO();writer.write(output)
        found=coffee_pdf(output.getvalue(),'url','today')
        self.assertEqual([(o['coffeeType'],o['priceChf']) for o in found],[('espresso',4.8)])

    def test_pdf_english_coffee_page_is_not_skipped(self):
        body=document([(20,450,'Filter Coffee 5.50'),(20,420,'Americano 4.80')])
        self.assertEqual({(o['coffeeType'],o['priceChf']) for o in coffee_pdf(body,'url','today')},{('filter',5.5),('americano',4.8)})

    def test_discovery_budget_applies_to_existing_unpriced_cafes_and_rotates(self):
        def venue(id,name,kind='cafe'):
            return {'id':id,'name':name,'type':kind,'website':'https://'+id+'.example','offers':[],'lat':47,'lon':8}
        cafes=[venue('a','A'),venue('b','B'),venue('c','C')]
        restaurant=venue('r','Restaurant','restaurant')
        priced={**venue('p','Priced'),'offers':[{'coffeeType':'espresso','priceChf':4.5}]}
        old={b['id']:b for b in cafes+[priced]}
        checks={'a':{'checkedAt':'2026-10-15'}}
        bars=cafes+[restaurant,priced]
        self.assertEqual([b['id'] for b in select_venues(bars,old,{},checks,1)],['p','b'])
        self.assertEqual([b['id'] for b in select_venues(bars,old,{},checks,1,missing_only=True)],['b'])
        self.assertEqual([b['id'] for b in select_venues(bars,old,{},checks,1,only='^A$')],['a'])
        self.assertEqual([b['id'] for b in select_venues(bars,old,{},checks,0)],['p','b','c','a','r'])

    def test_parallel_html_columns_require_matching_rows(self):
        def markup(prices):
            return ('<div class="fluid-engine"><div><p>Espresso<br>Cappuccino<br>Extra Shot</p></div><div><p>'+prices+'</p></div></div>').encode()
        text,_=html_content(markup('4.50<br>5.50<br>+1.50'),'https://example.com')
        self.assertEqual({(o['coffeeType'],o['priceChf']) for o in self.parse(text)},{('espresso',4.5),('cappuccino',5.5)})
        text,_=html_content(markup('4.50<br>5.50'),'https://example.com')
        self.assertEqual(self.parse(text),[])

    def test_reviewed_coffee_requires_exact_pdf_and_venue(self):
        body=document([]);url='https://example.com/menu.pdf'
        offer={'name':'Espresso','coffeeType':'espresso','volumeMl':None,'priceChf':4.5,'alcoholFree':True,'evidence':'PDF S. 1: Espresso 4.50'}
        review={url:{'barId':'node/1','sha256':hashlib.sha256(body).hexdigest(),'exclusive':True,'offers':[offer]}}
        class Fetch:
            def get(self,url):return url,'application/pdf',body
        bar={'id':'node/1','website':url,'offers':[]}
        with patch('scraper.scrape.REVIEWED_COFFEE_MENUS',review):
            found=scrape_bar(bar,Fetch(),{},1,'coffee')
            self.assertEqual(found['offers'][0]['confidence'],'reviewed')
            self.assertEqual(scrape_bar({**bar,'id':'node/2'},Fetch(),{},1,'coffee')['offers'],[])
            review[url]['sha256']='changed'
            changed=scrape_bar({**bar,'offers':found['offers']},Fetch(),{},1,'coffee')
            self.assertEqual(changed['offers'],[])
            self.assertEqual(changed['scrapeStatus'],'review_required')

    def test_embedded_city_table_preserves_rows_and_rejects_ambiguous_double(self):
        import html
        rows=[[{'value':'Café Crème, Espresso, Ristretto (Bio und Fair Trade)'},{'value':'3.20'}],[{'value':'Doppelter Espresso, Ristretto (Bio und Fair Trade)'},{'value':'4.20'}],[{'value':'Espresso'}],[{'value':'2.00'}]]
        markup=('<stzh-datatable rows="'+html.escape(json.dumps(rows))+'"></stzh-datatable>').encode()
        text,_=html_content(markup,'https://example.com')
        self.assertEqual({(o['coffeeType'],o['priceChf']) for o in self.parse(text)},{('creme',3.2),('espresso',3.2),('ristretto',3.2)})

    def test_pdf_price_alignment_and_footer_not_a_price(self):
        body=document([(20,450,'Espresso'),(220,450,'4.50'),(20,420,'Cappuccino'),(20,405,'5.50'),(20,47,'LATTE MACCHIATO'),(20,30,'2')])
        offers=coffee_pdf(body,'https://example.com/menu.pdf','2026-10-15')
        self.assertEqual([(o['coffeeType'],o['priceChf']) for o in offers],[('espresso',4.5),('cappuccino',5.5)])
        self.assertTrue(all(o['evidence'].startswith('PDF S. 1:') for o in offers))

    def test_html_adjacency_and_beer_coffee_isolation(self):
        html=b'<div><p>Cappuccino</p><div>5.50</div></div><p>Lager 5dl 7.00</p>'
        class Fetcher:
            def get(self,url):return url,'text/html',html
        bar={'id':'node/0','website':'https://example.com/','offers':[]}
        coffee=scrape_bar(bar,Fetcher(),{},1,'coffee')
        beer=scrape_bar(bar,Fetcher(),{},1)
        self.assertEqual([o['coffeeType'] for o in coffee['offers']], ['cappuccino'])
        self.assertEqual([o['priceChf'] for o in beer['offers']], [7])
        self.assertTrue(all('coffeeType' not in o for o in beer['offers']))

    def test_meeting_and_other_branch_menus_are_not_cafe_prices(self):
        self.assertFalse(source_allowed('node/0','https://example.com/Sitzungen_2025.pdf','coffee'))
        self.assertFalse(source_allowed('node/315566479','https://www.neumarkt-zuerich.ch/media/260330_menue_cento_vini_de.pdf','coffee'))
        self.assertFalse(source_allowed('node/3075095235','https://cdn.example/Menukarte_DE.pdf','coffee'))
        self.assertTrue(source_allowed('node/3075095235','https://cdn.example/MENU_TS_DE.pdf','coffee'))
        _,links=html_content(b'<a href="/Sitzungen_2025.pdf">Sitzungen</a><a href="/menu.pdf">Menu</a>','https://example.com','coffee')
        self.assertEqual(links,['https://example.com/menu.pdf'])

    def test_coffee_branch_and_lunch_scopes(self):
        self.assertFalse(source_allowed('node/370657577','https://example.com/Menu_VD_web.pdf','coffee'))
        self.assertTrue(source_allowed('node/370657577','https://example.com/_Menu_ZH_web.pdf','coffee'))
        self.assertFalse(source_allowed('node/503668298','https://www.fuerdich.ch/damm-drinks','coffee'))
        self.assertFalse(source_allowed('node/0','https://example.com/Wochenmenue.pdf','coffee'))
        self.assertTrue(source_allowed('node/0','https://example.com/Wochenmenue.pdf','beer'))

    def test_coffee_crawl_reaches_cafe_then_hashed_drinks_pdf_with_small_budget(self):
        home='https://example.com/'
        cafe=home+'cafe-bar/'
        menu=home+'files/abc123.pdf'
        pages={home: ('text/html', b'<a href="/wine.pdf">Wine list</a><a href="/shop/coffee">Coffee beans</a><a href="/cafe-bar/">Cafe &amp; Bar</a>'),
               cafe: ('text/html', b'<a href="/food.pdf">Food menu</a><a href="/files/abc123.pdf">Getraenkekarte</a>'),
               menu: ('application/pdf', document([(20,450,'Cappuccino 5.50')]))}
        visited=[]
        class Fetch:
            def get(self,url):
                visited.append(url)
                kind,body=pages[url]
                return url,kind,body
        found=scrape_bar({'id':'node/0','website':home,'offers':[]},Fetch(),{},3,'coffee')
        self.assertEqual(visited,[home,cafe,menu])
        self.assertEqual([(o['coffeeType'],o['priceChf']) for o in found['offers']],[('cappuccino',5.5)])

    def test_coffee_navigation_stays_on_origin_and_does_not_spend_budget_on_photos(self):
        markup=b'<a href="/cafe">Cafe</a><a href="https://other.example/cafe">Cafe</a><img src="/coffee-menu.jpg"><a href="/shop/coffee">Coffee</a><a href="/menu.pdf">Menu</a>'
        _,links=html_content(markup,'https://example.com','coffee')
        self.assertEqual(links,['https://example.com/menu.pdf','https://example.com/cafe','https://example.com/shop/coffee'])
        # Existing beer callers retain their original navigation rules.
        self.assertNotIn('https://example.com/cafe',html_content(markup,'https://example.com')[1])

    def test_coffee_priority_decodes_urls_and_keeps_fallbacks(self):
        links=['https://example.com/wine.pdf','https://example.com/speisekarte.pdf','https://example.com/Getr%C3%A4nkekarte.pdf']
        self.assertEqual(prioritize_links(links,'coffee'),[links[2],links[1],links[0]])

    def test_archive_retains_actual_date_and_redirect(self):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'a.json'
            file.write_text(json.dumps({'url':'https://example.com/menu','requestedUrl':'http://www.example.com/menu/','kind':'text/html','observedAt':'2026-10-14T12:00:00Z'}))
            file.with_suffix('.body').write_bytes(b'<p>Espresso 4.50</p>')
            fetcher=ArchiveFetcher([folder])
            final,kind,body=fetcher.get('http://www.example.com/menu/')
            self.assertEqual(fetcher.docs[final]['stamp'],'2026-10-14T12:00:00Z')
            self.assertEqual(kind,'text/html')
            self.assertIn(b'Espresso',body)

    def test_expiring_download_links_use_the_venue_page(self):
        body=document([(20,450,'Espresso 4.50')])
        class Fetch:
            def get(self,url):return 'https://cdn.example/menu.pdf?X-Amz-Signature=temporary','application/pdf',body
        bar={'id':'node/0','website':'https://example.com/menu','offers':[]}
        found=scrape_bar(bar,Fetch(),{},1,'coffee')
        self.assertEqual(found['offers'][0]['sourceUrl'],bar['website'])
