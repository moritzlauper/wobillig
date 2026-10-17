"""Product eligibility is independent of packaging or serving format."""
import re
import unicodedata

# Keep in sync with isBeerMix in src/data.ts; shared cases live in tests/fixtures.
# Moretti Limone is sold as Radler: https://www.birramoretti.it/le-birre/limone/
MIX = re.compile(r"\b(?:panach(?:e+)?|panash|henach(?:e+)?|radler|moretti\s+limone|shandy|diesel|russ(?:en)?|snakebite|black\s*(?:&|and)\s*tan|biermisch(?:getrank\w*)?|biermix\w*|beer\s*mix\w*|(?:bier|beer|lager|weizen)\s*(?:mit|with|[+&])\s*(?:cola|sprite|limonade|lemonade|zitronenlimonade))\b", re.I)


def is_beer_mix(name):
    normalized = ''.join(c for c in unicodedata.normalize('NFKD', name) if not unicodedata.combining(c))
    return bool(MIX.search(normalized))


def eligible_offer(offer):
    return bool(offer.get('coffeeType') or offer.get('pizzaType') or not is_beer_mix(offer['name']))
