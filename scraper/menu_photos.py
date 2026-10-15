"""OCR of individually dated menu photos. Photo discovery/date checks are manual.

The Places Photos API does not expose photo dates. Never substitute the fetch
or review date for a photo date. This module consumes a curated source list.
"""
from calendar import monthrange
from datetime import date, datetime
from zoneinfo import ZoneInfo
import hashlib
import mimetypes
from pathlib import Path
import re
from urllib.parse import urlparse
from scraper.ai import documents, clean_offers, SYSTEM, BudgetExhausted, APIUnavailable

ROOT = Path(__file__).resolve().parents[1]
PHOTO_INPUTS = ROOT / 'scraper/photo_inputs'


def today():
    return datetime.now(ZoneInfo('Europe/Zurich')).date()


def shift_months(day, months):
    year, month = divmod(day.year * 12 + day.month - 1 + months, 12)
    return date(year, month + 1, min(day.day, monthrange(year, month + 1)[1]))


def photo_window(value, at=None):
    """Conservative earliest date: a month alone never invents a specific day."""
    at = at or today()
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}(?:-\d{2})?', value):
        raise ValueError('missing_or_invalid_photo_date')
    first = date.fromisoformat(value + '-01' if len(value) == 7 else value)
    if not shift_months(at, -6) <= first <= at:
        raise ValueError('photo_older_than_six_months_or_future')
    # Expiry is derived from the photo, never refreshed by rescanning.
    return first, shift_months(first, 6)


def photo_source(row, venues, at=None):
    at = at or today()
    if row.get('barId') not in venues or row.get('venueConfirmed') is not True:
        raise ValueError('unconfirmed_venue')
    if row.get('isMenu') is not True:
        raise ValueError('not_a_menu')
    first, expires = photo_window(row.get('photoDate'), at)
    checked = date.fromisoformat(row.get('dateCheckedAt', ''))
    if not first <= checked <= at or checked < shift_months(at, -6):
        raise ValueError('invalid_date_check')
    if not isinstance(row.get('dateEvidence'), str) or not 4 <= len(row['dateEvidence']) <= 300:
        raise ValueError('missing_date_evidence')
    source = urlparse(row.get('sourceUrl', ''))
    if source.scheme != 'https' or source.hostname not in ('www.google.com', 'maps.google.com', 'www.google.ch') or not source.path.startswith('/maps/') or source.username or source.password:
        raise ValueError('invalid_maps_photo_link')
    image = urlparse(row.get('imageUrl', ''))
    if image.scheme != 'https' or not re.fullmatch(r'lh\d+\.googleusercontent\.com', image.hostname or '') or image.username or image.password or image.port not in (None, 443):
        raise ValueError('invalid_photo_image_url')
    return {'kind': 'google_maps_photo', 'date': row['photoDate'],
            'dateEvidence': row['dateEvidence'], 'dateCheckedAt': checked.isoformat(),
            'validUntil': expires.isoformat()}


def scan_photos(rows, venues, client, fetcher, at=None):
    """Uses the caller's Claude client, sharing its 0.50 USD budget and cache."""
    at = at or today()
    found, report, seen = [], [], set()
    for row in rows:
        if not isinstance(row, dict):
            report.append({'status': 'skipped', 'reason': 'invalid_photo_record'})
            continue
        label = {'barId': row.get('barId'), 'sourceUrl': row.get('sourceUrl')}
        try:
            metadata = photo_source(row, venues, at)
            if row['imageUrl'] in seen: continue
            seen.add(row['imageUrl'])
            if row.get('imagePath'):
                path = (ROOT / row['imagePath']).resolve()
                if not path.is_relative_to(PHOTO_INPUTS.resolve()) or path.stat().st_size > 4_500_000:
                    raise ValueError('invalid_local_photo')
                body = path.read_bytes()
                if hashlib.sha256(body).hexdigest() != row.get('sha256'):
                    raise ValueError('photo_hash_mismatch')
                kind = mimetypes.guess_type(path)[0] or ''
            else:
                final, kind, body = fetcher.get(row['imageUrl'])
                # Redirected image must remain on the public image service too.
                photo_source({**row, 'imageUrl': final}, venues, at)
            if kind.split(';')[0] not in ('image/jpeg', 'image/png', 'image/webp'):
                raise ValueError('not_an_image')
            blocks = list(documents(body, kind))
            if not blocks: raise ValueError('image_too_large')
            venue = venues[row['barId']]
            prompt = {'type': 'text', 'text': f'Menu photo for {venue["name"]}, {venue.get("address", "")}, Zürich. Photo date: {row["photoDate"]}. Extract only clearly legible, unconditional on-premise beer/coffee prices. Tally marks, donations, receipts and a photographed drink without a menu are not prices. Ignore text bleeding through from the reverse side. Omit unsupported coffee categories such as cortado, tea-based lattes/cappuccinos, cold brew and iced drinks. Named beans under a FILTER coffee heading are filter coffee. If uncertain, return no offer. Never guess a digit, volume or price.'}
            result = client.ask(blocks[0][0] + [prompt], system=SYSTEM)
            offers = clean_offers(result, row['sourceUrl'], at.isoformat())
            digest = hashlib.sha256(body).hexdigest()
            for offer in sorted(offers, key=lambda o: o['priceChf']):
                offer.update(photoSource=metadata, sourceSha256=digest)
                found.append((row['barId'], offer))
            report.append({**label, 'status': 'scanned', 'offers': len(offers)})
        except BudgetExhausted:
            report.append({**label, 'status': 'budget_limit'})
            break
        except (ValueError, APIUnavailable) as exc:
            report.append({**label, 'status': 'skipped', 'reason': str(exc)[:240]})
            if client.disabled: break
        except Exception as exc:
            report.append({**label, 'status': 'skipped', 'reason': type(exc).__name__})
    return found, report


def prune_expired_photos(venues, at=None):
    at = at or today()
    for venue in venues:
        active = []
        for offer in venue['offers']:
            if offer.get('photoSource') and offer.get('confidence') != 'community':
                try: photo_window(offer['photoSource'].get('date'), at)
                except (ValueError, TypeError): continue
            active.append(offer)
        venue['offers'] = active
