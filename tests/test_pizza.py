import unittest
from scraper.pizza import pizza_row, pizza_html

class PizzaTests(unittest.TestCase):
    def test_regular_pizzas(self):
        for text,price in [('Margherita 18',18),('Pizza Margherita Tomaten, Mozzarella, Basilikum CHF 18.50',18.5),('Margherita 32 cm 19.50',19.5),('Margerita 17.–',17)]:
            with self.subTest(text=text):
                offers=pizza_row(text,'https://example.org/menu','2026-10-15')
                self.assertEqual(offers[0]['priceChf'],price)
                self.assertEqual(offers[0]['pizzaType'],'margherita')
                self.assertIsNone(offers[0]['volumeMl'])
    def test_ambiguous_and_special_portions(self):
        for text in ['Margherita 14.50 17.50','Margherita 20 cm 12','Margherita 45 cm 30','Margherita Bufala 25','Regina Margherita 23','Margherita vegan 20','Margherita Kinderpizza 10','Margherita +3','Margherita 6','Margherita 18 Prosciutto 24','Margherita mit Schinken 18','Margherita Take-away 15','Pizza Margherita 18.50 28cm 32cm']:
            with self.subTest(text=text):self.assertEqual(pizza_row(text,'url','date'),[])
    def test_html_sections(self):
        html=b'<h2>Pizza</h2><div><h3>Margherita</h3><p>Tomaten, Mozzarella</p><span>18.50</span></div><h2>Kinderpizzen</h2><div>Margherita 10</div>'
        self.assertEqual([o['priceChf'] for o in pizza_html(html,'url','date')],[18.5])
        self.assertEqual(pizza_html(b'<title>Pizza online bestellen</title><div>Margherita 15</div>','url','date')[0]['priceContext'],'online_menu')


class PizzaCrawlTests(unittest.TestCase):
    def setUp(self):
        self.bar={'id':'node/1','name':'Test Pizza','website':'https://example.org/','offers':[]}
    def test_ambiguous_prices_stay_unpublished(self):
        from scraper.scrape_pizza import crawl
        class Fetcher:
            def get(self,url):return url,'text/html',b'<div>Margherita 18</div><div>Margherita 20</div>'
        bar,check=crawl(self.bar,Fetcher(),{},1,[])
        self.assertEqual(bar['offers'],[])
        self.assertEqual(check['status'],'ambiguous_prices')
    def test_review_requires_unchanged_document(self):
        from scraper.scrape_pizza import crawl
        import hashlib
        body=b'image bytes'
        offer={'name':'Pizza Margherita','pizzaType':'margherita','priceChf':18,'volumeMl':None,'alcoholFree':True,'evidence':'reviewed image'}
        review={'url':self.bar['website'],'barIds':[self.bar['id']],'sha256':hashlib.sha256(body).hexdigest(),'offers':[offer]}
        class Fetcher:
            def get(self,url):return url,'image/jpeg',body
        bar,_=crawl(self.bar,Fetcher(),{},1,[review])
        self.assertEqual(bar['offers'][0]['confidence'],'reviewed')
        review['sha256']='changed'
        result,check=crawl(bar,Fetcher(),{},1,[review])
        self.assertEqual(result['offers'],[])
        self.assertEqual(check['status'],'review_required')
    def test_scoped_branch_does_not_borrow_homepage_price(self):
        from scraper.scrape_pizza import crawl
        class Fetcher:
            def get(self,url):return url,'text/html',b'<div>Margherita 18</div>' if url.endswith('branch') else b'<div>Margherita 25</div>'
        bar,_=crawl(self.bar,Fetcher(),{'node/1':['https://example.org/branch']},3,[])
        self.assertEqual([o['priceChf'] for o in bar['offers']],[18])

if __name__=='__main__':unittest.main()


class PizzaDiscoveryTests(unittest.TestCase):
    def test_cuisine_and_no_price_are_independent(self):
        from scraper.scrape_pizza import is_pizza_venue
        self.assertTrue(is_pizza_venue({'name': 'Grottino 77', 'cuisine': ['pizza'], 'offers': []}))
        self.assertTrue(is_pizza_venue({'name': 'ALBA', 'cuisine': ['italian', 'pizza'], 'website': None}))
        self.assertFalse(is_pizza_venue({'name': 'Restaurant', 'cuisine': ['italian']}))

    def test_shared_host_distinct_branch_pages_are_scoped(self):
        from scraper.scrape_pizza import scoped_hints
        bars = [{'id': '1', 'website': 'https://example.org/branch-a'},
                {'id': '2', 'website': 'https://example.org/branch-b'},
                {'id': '3', 'website': 'https://example.org/'},
                {'id': '4', 'website': 'https://example.org/'}]
        self.assertEqual(scoped_hints(bars, {}), {'1': [bars[0]['website']], '2': [bars[1]['website']]})

    def test_branch_schema_menu_is_followed_without_other_branch(self):
        from scraper.scrape_pizza import crawl
        import json
        bar = {'id': '1', 'name': 'Alba', 'website': 'https://example.org/wiedikon', 'offers': []}
        schema = {'@type': 'Restaurant', 'url': bar['website'], 'menu': 'https://cdn.example.org/menu'}
        body = ('<title>Alba Pizzeria</title><script type="application/ld+json">' + json.dumps(schema) + '</script><a href="/other-menu">Menu</a>').encode()
        class Fetcher:
            def get(self, url):
                if url == bar['website']: return url, 'text/html', body
                if url == schema['menu']: return url, 'text/html', b'<div>Margherita 19</div>'
                raise AssertionError('Cross-branch menu followed')
        result, check = crawl(bar, Fetcher(), {'1': [bar['website']]}, 5, [])
        self.assertEqual([o['priceChf'] for o in result['offers']], [19])
        self.assertEqual(len(check['visited']), 2)
        self.assertIn('pizzaEvidence', result)

    def test_orderstar_reads_standard_size_not_family_price(self):
        from scraper.pizza import pizza_orderstar
        import json
        product = {'name': 'Pizza Margherita', 'description': 'Tomaten, Mozzarella, Oregano',
                   'price': 17, 'sizes': [{'name': '32cm', 'price': 17}, {'name': '40cm', 'price': 32}]}
        data = {'isSuccessful': True, 'categories': [{'name': 'Pizza', 'products': [product]}]}
        result = pizza_orderstar(json.dumps(data), 'https://example.org/Home/GetHomeData', 'date')
        self.assertEqual([o['priceChf'] for o in result], [17])
        self.assertEqual(result[0]['priceContext'], 'online_menu')
        data['categories'][0]['name'] = 'Kinder Pizza'
        self.assertEqual(pizza_orderstar(json.dumps(data), 'url', 'date'), [])

    def test_orderstar_crawl_fetches_public_feed(self):
        from scraper.scrape_pizza import crawl
        import json
        bar = {'id': '1', 'name': 'Bella Napoli', 'website': 'https://example.org/', 'offers': []}
        data = {'isSuccessful': True, 'categories': [{'name': 'Pizza', 'products': [{'name': 'Margherita', 'price': 17}]}]}
        class Fetcher:
            def get(self, url):
                if url.endswith('/GetHomeData'): return url, 'application/json', json.dumps(data).encode()
                return url, 'text/html', b'<script src="/bundles/js/orderstar.loc.js?v=123"></script>'
        result, _ = crawl(bar, Fetcher(), {}, 3, [])
        self.assertEqual([o['priceChf'] for o in result['offers']], [17])


class PizzaOsmRegressionTests(unittest.TestCase):
    def test_discovery_preserves_multi_cuisine_tags(self):
        from scraper.scrape import discover
        from unittest.mock import patch, Mock
        response = Mock()
        response.json.return_value = {'elements': [{'type': 'node', 'id': 1, 'lat': 47.37, 'lon': 8.52,
            'tags': {'name': 'Grottino 77', 'amenity': 'restaurant', 'cuisine': 'italian; pizza'}}]}
        with patch('scraper.scrape.requests.get', return_value=response):
            result = discover({})
        self.assertEqual(result['bars'][0]['cuisine'], ['italian', 'pizza'])


class PizzaCatalogueRegressionTests(unittest.TestCase):
    def test_pizzerias_without_crawlable_menu_still_get_published(self):
        from scraper import scrape_pizza as module
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from unittest.mock import patch
        import json
        bars = [
            {'id': '1', 'name': 'Grottino 77', 'type': 'restaurant', 'cuisine': ['pizza'], 'website': None, 'offers': []},
            {'id': '2', 'name': 'ALBA', 'type': 'restaurant', 'cuisine': ['pizza'], 'website': 'https://example.org/', 'offers': []},
            {'id': '3', 'name': 'Alba Pizza', 'type': 'restaurant', 'cuisine': [], 'website': 'https://example.org/', 'offers': []},
            {'id': '4', 'name': 'Drinks only', 'type': 'bar', 'website': None, 'offers': []}]
        with TemporaryDirectory() as directory:
            root = Path(directory)
            venues = root/'venues.json'; venues.write_text(json.dumps({'bars': bars}))
            with patch.object(module, 'DATA', root/'pizza.json'), patch.object(module, 'CHECKS', root/'checks.json'), \
                 patch.object(module, 'HINTS_PATH', root/'hints.json'), patch.object(module, 'REVIEWS_PATH', root/'reviews.json'), \
                 patch('sys.argv', ['scrape_pizza', '--venues-file', str(venues)]), patch.object(module, 'crawl') as crawl:
                module.main()
            result = json.loads((root/'pizza.json').read_text())
            self.assertEqual({b['id'] for b in result['bars']}, {'1', '2', '3'})
            self.assertTrue(all(not b['offers'] for b in result['bars']))
            crawl.assert_not_called()


class PizzaRecallRegressionTests(unittest.TestCase):
    def test_spaced_decimal_and_price_before_heading(self):
        for text in ['Margherita Tomatensauce, Mozzarella 18. 00', 'CHF 18.00 Pizza Margherita Tomaten, Mozzarella']:
            self.assertEqual(pizza_row(text,'url','date')[0]['priceChf'],18)

    def test_product_size_and_extras_are_separate(self):
        html='''<div class="menucat"><div class="category-name">Pizza Ø30cm</div>
        <div class="meal-wrapper"><div itemprop="name">Pizza Margherita</div>
        <div itemprop="description">Tomaten, Mozzarella</div><div itemprop="price">18,00 CHF</div>
        <div>inkl. Pfand (0,00 CHF)</div></div></div>
        <div class="menucat"><div class="category-name">Pizza Ø36cm</div>
        <div class="meal-wrapper"><div itemprop="name">Pizza Margherita</div><div itemprop="price">21,00 CHF</div></div></div>'''
        offers=pizza_html(html,'url','date')
        self.assertEqual([o['priceChf'] for o in offers],[18])
        self.assertEqual(offers[0]['priceContext'],'online_menu')

    def test_wordpress_size_prices(self):
        html='''<article class="wppizza-article"><h2 class="wppizza-article-title">Pizza Margherita</h2>
        <div class="wppizza-article-price"><span>16,00</span><div class="wppizza-article-size">32cm</div></div>
        <div class="wppizza-article-price"><span>28,00</span><div class="wppizza-article-size">40cm</div></div>
        <p class="wppizza-article-content">Tomaten, Mozzarella, Oregano</p></article>'''
        self.assertEqual([o['priceChf'] for o in pizza_html(html,'url','date')],[16])

    def test_pdf_surcharge_header_does_not_hide_regular_pizza(self):
        from tests.test_pdf import document
        from scraper.pizza import pizza_pdf
        body=document([(20,480,'KLEINE PIZZA -2 TAKE AWAY -2'),(20,440,'MARGHERITA'),
                       (20,425,'Tomaten, Mozzarella'),(400,425,'17'),
                       (20,380,'KINDER'),(20,350,'Margherita 10')])
        self.assertEqual([o['priceChf'] for o in pizza_pdf(body,'url','date',ocr=False)],[17])

    def test_scanned_pdf_uses_ocr_and_rejects_children(self):
        import shutil
        if not shutil.which('tesseract'):self.skipTest('tesseract not installed')
        from PIL import Image, ImageDraw, ImageFont
        from io import BytesIO
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from unittest.mock import patch
        from scraper.pizza import pizza_pdf
        font=ImageFont.load_default(size=38)
        page=Image.new('RGB',(1500,900),'white');draw=ImageDraw.Draw(page)
        for xy,text in [((70,50),'PIZZA'),((70,150),'MARGHERITA'),((70,210),'Tomaten, Mozzarella'),((1200,210),'18.00'),
                        ((70,400),'KINDER'),((70,470),'MARGHERITA 10.00')]:draw.text(xy,text,font=font,fill='black')
        body=BytesIO();page.save(body,format='PDF',resolution=200)
        with TemporaryDirectory() as directory, patch('scraper.menu_ocr.CACHE_DIR',Path(directory)):
            offers=pizza_pdf(body.getvalue(),'https://example.org/menu.pdf','date')
        self.assertEqual([o['priceChf'] for o in offers],[18])
        self.assertEqual(offers[0]['extractionMethod'],'ocr')

    def test_low_confidence_or_distant_ocr_price_is_not_accepted(self):
        from tests.test_pdf import document
        from scraper.pizza import ocr_pizza_image
        from unittest.mock import patch
        body=document([(20,450,'Margherita 18.00')])
        name={'text':'Margherita','conf':'96','left':'20','top':'50','width':'80','height':'20'}
        price={'text':'18.00','conf':'50','left':'400','top':'50','width':'50','height':'20'}
        with patch('scraper.menu_ocr.searchable_image',return_value=(body,[name,price])):
            self.assertEqual(ocr_pizza_image(None,'url','date'),[])
        price.update(conf='96',top='500')
        with patch('scraper.menu_ocr.searchable_image',return_value=(body,[name,price])):
            self.assertEqual(ocr_pizza_image(None,'url','date'),[])

    def test_branch_follows_linked_pdf_and_not_sibling_branch(self):
        from tests.test_pdf import document
        from scraper.scrape_pizza import crawl
        bar={'id':'1','name':'Pizza','website':'https://example.org/branch','offers':[]}
        class Fetcher:
            def get(self,url):
                if url.endswith('.pdf'):return url,'application/pdf',document([(20,450,'Margherita 18')])
                return url,'text/html',b'<a href="https://cdn.example.org/menu.pdf">Menu</a><a href="/other-menu">Menu</a>'
        result,check=crawl(bar,Fetcher(),{'1':[bar['website']]},5,[])
        self.assertEqual([o['priceChf'] for o in result['offers']],[18])
        self.assertNotIn('https://example.org/other-menu',check['visited'])

    def test_restaurant_price_precedes_separate_online_price(self):
        from scraper.scrape_pizza import crawl
        bar={'id':'1','name':'Pizza','website':'https://example.org/','offers':[]}
        class Fetcher:
            def get(self,url):
                return (url,'text/html',b'<title>Online bestellen</title><div>Margherita 15</div>') if url.endswith('/order') else (url,'text/html',b'<div>Margherita 17</div><a href="/order">Order</a>')
        result,_=crawl(bar,Fetcher(),{},4,[])
        self.assertEqual([o['priceChf'] for o in result['offers']],[17])

    def test_discovery_reads_original_images_but_never_cart_actions(self):
        from scraper.scrape_pizza import pizza_links,skip_source
        html=b'<img alt="Pizza menu" src="https://static.wixstatic.com/media/menu.jpg/v1/fill/w_200/menu.jpg"><a href="/menu?add-to-cart=1">Pizza</a>'
        self.assertEqual(pizza_links(html,'https://example.org/menu'),['https://static.wixstatic.com/media/menu.jpg'])
        for url in ['https://example.org/menu?add_to_wishlist=1','https://example.org/menu?add-to-cart=2','https://example.org/checkout/']:
            self.assertTrue(skip_source(url))
        self.assertFalse(skip_source('https://example.org/menus-weine/'))

    def test_pdf_neighboring_dish_does_not_hide_margherita(self):
        from tests.test_pdf import document
        from scraper.pizza import pizza_pdf
        body=document([(20,460,'PIZZA'),(20,430,'MARGHERITA 16.50 TOSCANA 22.00'),
                       (20,400,'NAPOLI 17.50 DIAVOLA 22.00')])
        self.assertEqual([o['priceChf'] for o in pizza_pdf(body,'url','date',ocr=False)],[16.5])

    def test_wix_family_section_and_online_url(self):
        html='<h2>PIZZAS</h2><h3>PIZZAS Standard</h3><div>Margherita 16</div><h3>PIZZAS FAMILY</h3><div>Margherita 36</div>'
        offers=pizza_html(html,'https://example.org/online-ordering','date')
        self.assertEqual([o['priceChf'] for o in offers],[16])
        self.assertEqual(offers[0]['priceContext'],'online_menu')

    def test_fragmented_ocr_decimal_requires_both_parts_confident(self):
        from tests.test_pdf import document
        from scraper.pizza import ocr_pizza_image
        from unittest.mock import patch
        body=document([(20,450,'MARGHERITA 18. 00')])
        words=[{'text':'MARGHERITA','conf':'95','left':'20','top':'50','width':'80','height':'20'},
               {'text':'18.','conf':'95','left':'400','top':'50','width':'30','height':'20'},
               {'text':'00','conf':'96','left':'435','top':'50','width':'20','height':'20'}]
        with patch('scraper.menu_ocr.searchable_image',return_value=(body,words)):
            self.assertEqual(ocr_pizza_image(None,'url','date')[0]['priceChf'],18)
        words[-1]['conf']='30'
        with patch('scraper.menu_ocr.searchable_image',return_value=(body,words)):
            self.assertEqual(ocr_pizza_image(None,'url','date'),[])


class PizzaExclusionTests(unittest.TestCase):
    def test_exclusion_removes_retained_prices_and_rediscovered_venue(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from scraper import scrape_pizza as module
        excluded={'id':'node/10779724980','name':'La Pizza Buona','website':'https://example.org/',
                  'type':'restaurant','cuisine':['pizza'],'offers':[{'pizzaType':'margherita','priceChf':13.9}]}
        retained={**excluded,'id':'node/2','name':'Neighbour Pizzeria','website':None,'offers':[]}
        with TemporaryDirectory() as directory:
            root=Path(directory)
            data=root/'pizza.json'; data.write_text(json.dumps({'bars':[excluded,retained]}))
            venues=root/'venues.json'; venues.write_text(json.dumps({'bars':[excluded,retained]}))
            exclusions=root/'exclusions.json'; exclusions.write_text(json.dumps({excluded['id']:{'reason':'User request'}}))
            with patch.object(module,'DATA',data), patch.object(module,'CHECKS',root/'checks.json'), \
                 patch.object(module,'EXCLUSIONS_PATH',exclusions), patch.object(module,'crawl') as crawl:
                for args in [[],['--retry'],['--venues-file',str(venues)]]:
                    with patch('sys.argv',['scrape_pizza',*args]):module.main()
                    self.assertEqual([b['id'] for b in json.loads(data.read_text())['bars']],[retained['id']])
                crawl.assert_not_called()
