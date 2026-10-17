"""Per-venue crawl diagnostics, kept separate from published price records."""
from collections import Counter
import time
from urllib.parse import urlsplit, urlunsplit


def log_url(url):
    # Signed download URLs can contain credentials in their query parameters.
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc.rsplit('@', 1)[-1], parsed.path, '', ''))


class TraceFetcher:
    def __init__(self, fetcher):
        self.fetcher = fetcher
        self.documents = []
        self.errors = []
        self.started = time.monotonic()

    def get(self, url):
        try:
            final, kind, body = self.fetcher.get(url)
        except Exception as exc:
            reason = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
            self.errors.append({'url': log_url(url), 'reason': reason, 'phase': 'fetch'})
            raise
        category = ('pdf' if 'pdf' in kind or urlsplit(final).path.lower().endswith('.pdf')
                    else 'html' if 'html' in kind else 'unsupported')
        self.documents.append({'url': log_url(final), 'kind': category})
        return final, kind, body

    def parse_error(self, url, exc):
        self.errors.append({'url': log_url(url), 'reason': type(exc).__name__, 'phase': 'parse'})

    def details(self):
        return {'documents': self.documents, 'errors': self.errors,
                'seconds': round(time.monotonic() - self.started, 1)}


def log_result(index, total, bar, details, category, max_pages):
    counts = Counter(d['kind'] for d in details['documents'])
    documents = ', '.join(f'{count} {kind}' for kind, count in sorted(counts.items())) or '0 documents'
    attempts = len(details['documents']) + sum(e['phase'] == 'fetch' for e in details['errors'])
    limit = '; page limit reached' if attempts >= max_pages else ''
    lines = [f"[{category} {index}/{total}] {bar['name']}: {bar['scrapeStatus']} "
             f"({len(bar['offers'])} {category} offers; {documents}; "
             f"{len(details['errors'])} errors; {details['seconds']}s{limit})"]
    for error in details['errors'][:3]:
        lines.append(f"  {error['phase']} error: {error['reason']} — {error['url']}")
    if len(details['errors']) > 3:
        lines.append(f"  ... {len(details['errors']) - 3} more errors")
    if not bar['offers']:
        for document in details['documents'][:3]:
            lines.append(f"  fetched ({document['kind']}): {document['url']}")
    print('\n'.join(lines), flush=True)


def log_summary(category, statuses, offers, fetcher):
    counts = ', '.join(f'{count} {status}' for status, count in sorted(statuses.items()))
    cache = getattr(fetcher, 'http_cache', None)
    reused = cache.hits if cache is not None else 0
    print(f'[{category}] Finished {sum(statuses.values())} venues: {counts or "none selected"}; '
          f'{offers} {category} offers in checked venues; {reused} cached document reuses.', flush=True)
