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
        self.assertEqual(pizza_html(b'<title>Pizza online bestellen</title><div>Margherita 15</div>','url','date'),[])


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
