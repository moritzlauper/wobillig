"""Branches of one chain that share a website.

OpenStreetMap lists every branch with the chain's website, so a scan that
groups venues by website sees several venues on one host. Chains price
their menu the same in every branch, so one read covers all of them.
Unrelated venues that only share a host (a page builder, a directory, a
mall) stay out: every branch name must carry the brand of the host.
"""
import re
import unicodedata
from urllib.parse import urlparse


def chain_label(website):
    """The brand part of a host: www.holycow.ch -> holycow, john-baker.ch -> johnbaker."""
    parts = (urlparse(website or '').hostname or '').removeprefix('www.').split('.')
    return re.sub(r'[\W_]', '', parts[-2] if len(parts) > 1 else parts[0]).casefold()


def is_chain(group):
    label = chain_label(group[0]['website'])
    names = [re.sub(r'[\W_]', '', unicodedata.normalize('NFKD', bar['name']).encode('ascii', 'ignore').decode()).casefold() for bar in group]
    return len(label) >= 4 and all(label in name or name in label for name in names)


# Words that name the chain or the kind of place, not one branch.
GENERIC = {'restaurant', 'bar', 'cafe', 'caffe', 'haus', 'bistro', 'zurich', 'zuerich', 'the', 'und', 'and', 'take', 'away'}


def ascii_words(text):
    return re.findall(r'[a-z0-9]+', unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().casefold())


def branch_tokens(bar, label):
    """Words that only this branch carries: "Hiltl am Strand" -> strand, Mythenquai 95 -> mythen."""
    words = [w for w in ascii_words(bar.get('name')) if len(w) >= 4 and w not in GENERIC and w not in label and label not in w]
    street = ascii_words(re.sub(r'\d.*$', '', bar.get('address') or ''))
    words += [re.sub(r'(?:strasse|gasse|weg|platz|quai)$', '', w) for w in street if len(w) >= 6]
    return {w for w in words if len(w) >= 4}


def split_chain(name, group, result):
    """Give each branch of a chain the menus that belong to it.

    One read covers a chain's website, but a branch with its own menu (Hiltl am
    Strand: food-drinks-amstrand.pdf) must not get the main menu's prices, and
    the other branches must not get the beach menu. An offer belongs to a branch
    when its source URL carries that branch's own word; a branch without such a
    menu takes the offers whose source names no branch. result['offers'] is a list
    or a dict of lists per category. Returns [(key, [bar], result)].
    """
    if len(group) < 2:
        return [(name, group, result)]
    label = chain_label(group[0]['website'])
    tokens = {bar['id']: branch_tokens(bar, label) for bar in group}
    source = lambda offer: ''.join(ascii_words(offer.get('sourceUrl') or offer.get('source') or ''))
    owner = lambda offer: {bid for bid, words in tokens.items() if any(w in source(offer) for w in words)}
    pick = lambda offers, bar: [o for o in offers if bar['id'] in owner(o)] or [o for o in offers if not owner(o)]
    if not any(owner(o) for o in (sum(result['offers'].values(), []) if isinstance(result['offers'], dict) else result['offers'])):
        return [(name, group, result)]
    split = []
    for bar in group:
        offers = ({category: pick(items, bar) for category, items in result['offers'].items()}
                  if isinstance(result['offers'], dict) else pick(result['offers'], bar))
        split.append((f'{name}#{bar["id"]}', [bar], {**result, 'offers': offers}))
    return split


def split_chains(groups, results):
    """split_chain for every website of a scan: new groups and results keyed alike."""
    new_groups, new_results = {}, {}
    for name, group in groups.items():
        for key, branch, result in split_chain(name, group, results[name]):
            new_groups[key], new_results[key] = branch, result
    return new_groups, new_results
