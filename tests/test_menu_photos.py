from datetime import date
import unittest
from unittest.mock import Mock
from scraper.menu_photos import photo_window, scan_photos, prune_expired_photos
from scraper.ai import BudgetExhausted

TODAY=date(2026,10,15)
VENUES={'node/1':{'id':'node/1','name':'Test','address':'Zurich'}}

def photo(**kw):
    result=dict(barId='node/1',sourceUrl='https://www.google.com/maps/place/Test/photo',imageUrl='https://lh3.googleusercontent.com/menu.jpg',photoDate='2026-09',dateCheckedAt='2026-10-15',dateEvidence='Photo - Sep 2026',venueConfirmed=True,isMenu=True)
    return {**result,**kw}

class PhotoTests(unittest.TestCase):
    def test_exact_six_month_boundary_and_conservative_month(self):
        self.assertEqual(photo_window('2026-04-15',TODAY)[0],date(2026,4,15))
        for value in ['2026-04-14','2026-04','2026-10-16','2026-11','2026-02-30','2026','',None]:
            with self.assertRaises(ValueError,msg=str(value)):photo_window(value,TODAY)
        self.assertEqual(photo_window('2026-09',TODAY)[1],date(2027,3,1))
        self.assertEqual(photo_window('2026-08-31',date(2027,2,28))[0],date(2026,8,31))

    def test_ineligible_photos_cost_nothing(self):
        rows=[photo(photoDate='2025-10'),photo(photoDate=None),photo(venueConfirmed=False),photo(isMenu=False),photo(dateEvidence=''),photo(imageUrl='https://127.0.0.1/a'),photo(dateCheckedAt='2026-10-16'),None]
        client=Mock(disabled=False);fetcher=Mock()
        found,report=scan_photos(rows,VENUES,client,fetcher,TODAY)
        self.assertEqual(found,[]);self.assertEqual(len(report),len(rows))
        client.ask.assert_not_called();fetcher.get.assert_not_called()

    def test_ocr_retains_photo_date_separately_from_scan_date(self):
        row=dict(name='Espresso',drink='coffee',coffeeType='espresso',volumeMl=None,priceChf=5,beerType='unknown',estimatedBeerType='unknown',estimateReason='',stange=False,alcoholFree=True,evidence='Espresso 5.00',page=1)
        client=Mock(disabled=False);client.ask.return_value={'offers':[row]}
        fetcher=Mock();fetcher.get.return_value=(photo()['imageUrl'],'image/jpeg',b'mocked image')
        found,report=scan_photos([photo(),photo()],VENUES,client,fetcher,TODAY)
        self.assertEqual(len(found),1);client.ask.assert_called_once()
        offer=found[0][1];self.assertEqual(offer['photoSource']['date'],'2026-09')
        self.assertEqual(offer['observedAt'],'2026-10-15')
        self.assertEqual(offer['sourceUrl'],photo()['sourceUrl'])
        self.assertEqual(offer['extractionModel'],'claude-haiku-5-5')
        # Repeated scans cannot renew an old photo's age.
        bar={'offers':[offer]};prune_expired_photos([bar],date(2027,3,2));self.assertEqual(bar['offers'],[])

    def test_photo_scan_obeys_shared_client_budget(self):
        client=Mock(disabled=False);client.ask.side_effect=BudgetExhausted()
        fetcher=Mock();fetcher.get.return_value=(photo()['imageUrl'],'image/jpeg',b'image')
        found,report=scan_photos([photo(),photo(imageUrl='https://lh3.googleusercontent.com/other')],VENUES,client,fetcher,TODAY)
        self.assertEqual(found,[]);client.ask.assert_called_once();self.assertEqual(report[0]['status'],'budget_limit')

    def test_unknown_and_untrusted_dates_do_not_refresh_existing_prices(self):
        normal={'priceChf':5,'confidence':'automatic'}
        old={**normal,'photoSource':{'date':'2025-01'}}
        user={**old,'confidence':'community'}
        bar={'offers':[normal,old,user]};prune_expired_photos([bar],TODAY)
        self.assertEqual(bar['offers'],[normal,user])
