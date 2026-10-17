"""Publish only explicitly reviewed menu dates bound to the exact document.

Reviewed-menu registries may supply menuDate={date, evidence}. Neither fetch
dates, filename dates nor HTTP Last-Modified establish a menu's validity date.
"""
from datetime import date
import hashlib


def verified_menu_date(review, body, stamp):
    proof = review.get('menuDate')
    if not isinstance(proof, dict) or not isinstance(proof.get('date'), str):
        return {}
    try:
        value = date.fromisoformat(proof['date'])
        if value.isoformat() != proof['date'] or value > date.fromisoformat(stamp[:10]):
            return {}
    except ValueError:
        return {}
    evidence = proof.get('evidence')
    digest = hashlib.sha256(body).hexdigest()
    if not isinstance(evidence, str) or not evidence.strip() or digest != review.get('sha256'):
        return {}
    return {'verifiedMenuDate': {'date': proof['date'], 'evidence': evidence.strip(), 'sha256': digest}}
