"""Where to start reading a venue's website."""
from urllib.parse import urlparse


def start_urls(website):
    """The website from OpenStreetMap, then its home page with and without "www".

    OpenStreetMap often keeps a branch page that has moved (b.good /langstrasse/
    answers 404) or a host spelling that no longer resolves. When the first
    address fails, a scan tries the next one before giving up on the venue.
    """
    parsed = urlparse(website or '')
    if not parsed.hostname:
        return [website]
    host = parsed.hostname
    other = host[4:] if host.startswith('www.') else 'www.' + host
    candidates = [website, f'https://{host}/', f'https://{other}/']
    return list(dict.fromkeys(url for url in candidates if url))
