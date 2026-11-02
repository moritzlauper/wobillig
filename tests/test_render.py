import unittest
from unittest import mock

from scraper import scrape
from scraper.render import needs_rendering

SHELL = b'<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>'
RENDERED = '<html><body><h1>Burger</h1>' + '<p>Classic Burger 18.50</p>' * 40 + '</body></html>'


class Robots:
    def can_fetch(self, *_): return True
    def crawl_delay(self, *_): return None
    def request_rate(self, *_): return None


class RenderTests(unittest.TestCase):
    def test_only_script_shells_need_rendering(self):
        self.assertTrue(needs_rendering(SHELL))
        self.assertFalse(needs_rendering(b'<html><body>' + b'<p>Classic Burger 18.50</p>' * 40 + b'<script></script></body></html>'))
        self.assertFalse(needs_rendering(b'<html><body>Kurz</body></html>'))

    def fetch(self, body, rendered):
        fetcher = scrape.Fetcher()
        fetcher.http_cache = None
        with mock.patch.object(fetcher, 'policy', return_value=Robots()), \
             mock.patch.object(fetcher, 'raw', return_value=(200, {'Content-Type': 'text/html'}, body)), \
             mock.patch.object(scrape, 'public_url'), \
             mock.patch.object(scrape, 'render', return_value=rendered) as render:
            return fetcher.get('https://burger.example/'), render

    def test_a_javascript_shell_is_replaced_by_the_rendered_page(self):
        (final, kind, body), render = self.fetch(SHELL, ('https://burger.example/karte', RENDERED))
        self.assertEqual((final, kind), ('https://burger.example/karte', 'text/html; charset=utf-8'))
        self.assertIn(b'Classic Burger 18.50', body)
        render.assert_called_once()

    def test_the_plain_page_stays_when_rendering_is_unavailable(self):
        (final, _kind, body), _render = self.fetch(SHELL, None)
        self.assertEqual((final, body), ('https://burger.example/', SHELL))

    def test_pages_with_text_are_never_rendered(self):
        page = b'<html><body>' + b'<p>Classic Burger 18.50</p>' * 40 + b'<script></script></body></html>'
        (_final, _kind, body), render = self.fetch(page, ('https://burger.example/', RENDERED))
        self.assertEqual(body, page)
        render.assert_not_called()


if __name__ == '__main__':
    unittest.main()
