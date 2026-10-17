"""Successful HTTP responses shared only within an explicitly configured scan job."""
from contextlib import closing
from pathlib import Path
import sqlite3
import threading


class RunHttpCache:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.guard = threading.Lock()
        self.locks = {}
        self.hits = 0
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS responses '
                       '(url TEXT PRIMARY KEY, final TEXT, kind TEXT, body BLOB)')

    def fetch(self, url, download):
        with self.guard:
            lock = self.locks.setdefault(url, threading.Lock())
        # The workflow runs the separate scraper processes sequentially. This
        # lock also coalesces concurrent requests inside each scraper process.
        with lock:
            with closing(sqlite3.connect(self.path)) as db:
                row = db.execute('SELECT final, kind, body FROM responses WHERE url = ?', (url,)).fetchone()
            if row is not None:
                with self.guard:
                    self.hits += 1
                return row
            final, kind, body = download()
            # Exceptions are never cached: later passes can retry failed URLs.
            with closing(sqlite3.connect(self.path)) as db, db:
                db.execute('INSERT OR REPLACE INTO responses VALUES (?, ?, ?, ?)',
                           (url, final, kind, body))
            return final, kind, body
