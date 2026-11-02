"""Render pages that build their menu with JavaScript.

Many restaurant sites (Public Burger, Gourmet Burger, ordering widgets)
send an almost empty HTML shell and load the menu in the browser. The
plain HTTP fetch then sees one page without text or links, and the scan
finds nothing. Such shells are opened once in headless Chromium and the
rendered HTML replaces the shell, so every scan reads the finished page.

Rendering is skipped when Playwright or its browser is missing, or when
WOBILLIG_RENDER=0; the plain HTML is used then, as before.
"""
import os
import threading

from bs4 import BeautifulSoup

# Below this much visible text a page with scripts is treated as a JavaScript shell.
SHELL_TEXT = 300
TIMEOUT_MS = 20000
_lock = threading.Lock()


def visible_text(html):
    soup = BeautifulSoup(html, 'html.parser')
    for node in soup(['script', 'style', 'noscript', 'template', 'svg']):
        node.decompose()
    return soup.get_text(' ', strip=True)


def needs_rendering(html):
    """An HTML shell: scripts, but almost no visible text."""
    text = html.decode('utf-8', errors='replace') if isinstance(html, bytes) else html
    return '<script' in text.lower() and len(visible_text(text)) < SHELL_TEXT


def render(url, user_agent):
    """The rendered HTML and final URL, or None when rendering is unavailable or fails."""
    if os.environ.get('WOBILLIG_RENDER') == '0':
        return None
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    # The sync API is not shared across threads; one page renders at a time.
    with _lock:
        try:
            with sync_playwright() as playwright:
                options = {'executable_path': os.environ['PLAYWRIGHT_CHROMIUM']} if os.environ.get('PLAYWRIGHT_CHROMIUM') else {}
                browser = playwright.chromium.launch(**options)
                try:
                    page = browser.new_page(user_agent=user_agent, java_script_enabled=True)
                    page.goto(url, wait_until='networkidle', timeout=TIMEOUT_MS)
                    return page.url, page.content()
                finally:
                    browser.close()
        except Exception:
            return None
