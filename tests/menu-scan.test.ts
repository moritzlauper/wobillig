import { describe, it, expect, vi } from 'vitest';
import { menuPrices, parseMenuPrice, outputTokenBudget, readMenu, validateScanImage, OCR_BUDGET_USD } from '../server/menu-ocr';
import { reserveScan, saveMenuScan, failScan } from '../server/menu-scan-store';
import { emptyState, WriteConflict, type State, type Store } from '../server/prices';
import { applyEntries, offerKey } from '../src/community';
import { scanSummary } from '../src/menu-scan';
import type { Bar, Offer } from '../src/data';

const bar: Bar = { id: 'node/1', name: 'Mars Bar', lat: 47, lon: 8, address: 'Neufrankengasse 15', postcode: '8004', website: null, type: 'pub', openingHours: null, outdoor: false, offers: [], scrapeStatus: '', checkedAt: null };
const row = { name: 'Sprint', category: 'beer', sizes: ['3dl', '5dl'], prices: ['5.20', '7.90'], beerType: 'draft', alcoholFree: false, clear: true };
const document = (rows: unknown[] = [row]) => ({ menu: true, wrongVenue: false, currency: 'unspecified', rows });
const extract = (rows: unknown[] = [row]) => menuPrices(document(rows), bar, '2026-10-16');
function memoryStore(): Store {
  let state = emptyState(), version = 0;
  return { async read() { return { state: structuredClone(state), etag: String(version) }; }, async write(next, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; } };
}

describe('menu interpretation', () => {
  it('pairs each Marsbar price with its printed size, including reversed columns', () => {
    expect(extract().prices.map(p => [p.input.volumeMl, p.input.priceChf, p.input.beerType])).toEqual([[300, 5.2, 'draft'], [500, 7.9, 'draft']]);
    expect(extract([{ ...row, sizes: ['50 cl', '0,3 l'], prices: ['7,90', '5.20'] }]).prices.map(p => [p.input.volumeMl, p.input.priceChf])).toEqual([[500, 7.9], [300, 5.2]]);
  });
  it.each([['8.–', 8], ['CHF 5.20', 5.2], ['5,7', 5.7], ['8.-', 8], ['8.—', 8], ['6 Fr.', 6]])('reads price %s', (text, value) => expect(parseMenuPrice(text)).toBe(value));
  it.each(['5/7', 'EUR 5', '5?', '5.200', '5.20 + 2', '5.20/l', '0', '51', 'free', '4.8%'])('rejects ambiguous price %s', value => expect(parseMenuPrice(value)).toBeUndefined());
  it('rejects an entire uncertain or incomplete row without shifting columns', () => {
    for (const patch of [{ clear: false }, { sizes: ['3dl'] }, { prices: ['5.20', '?'] }, { sizes: ['4.8%', '5dl'] }, { sizes: ['3', '5'] }, { sizes: ['3dl', '5.0%'] }]) {
      expect(extract([{ ...row, ...patch }])).toEqual({ prices: [], skipped: 1 });
    }
  });
  it('keeps unknown packaging unknown and requires explicit Stange for missing size', () => {
    expect(extract([{ ...row, beerType: 'unknown' }]).prices.every(p => p.input.beerType === 'unknown')).toBe(true);
    expect(extract([{ ...row, sizes: ['Stange'], prices: ['5.20'] }]).prices[0].input).toMatchObject({ volumeMl: null, serving: 'stange' });
    expect(extract([{ ...row, sizes: [''], prices: ['5.20'] }]).prices).toEqual([]);
    expect(extract([{ ...row, beerType: 'bottle', sizes: ['Stange'], prices: ['5.20'] }]).prices).toEqual([]);
  });
  it('strips alcohol percentage and volume from beer names', () => {
    expect(extract([{ ...row, name: 'IPA 50 cl' }, { ...row, name: 'Feldschlösschen alkoholfrei 0.0% 33cl' }, { ...row, name: 'Lager 5,2 % 0,5 l' }]).prices.map(p => p.input.name))
      .toEqual(['IPA', 'IPA', 'Feldschlösschen alkoholfrei', 'Feldschlösschen alkoholfrei', 'Lager', 'Lager']);
  });
  it('excludes beer mixes, unsupported categories and invented client metadata', () => {
    expect(extract([{ ...row, name: 'Panaché' }, { ...row, category: 'tea' }]).prices).toEqual([]);
    const result = extract([{ ...row, barId: 'node/other', observedAt: '2099-01-01', sourceUrl: 'https://attacker.example', confidence: 'reviewed' }]);
    expect(result.prices[0].input).toMatchObject({ barId: bar.id, observedAt: '2026-10-16', sourceUrl: '' });
  });
  it('handles coffee and normal Margherita without invented volumes', () => {
    const result = extract([{ ...row, name: 'Cappuccino', category: 'cappuccino', sizes: [''], prices: ['5.50'] }, { ...row, name: 'Margherita', category: 'pizza_margherita', sizes: [''], prices: ['18.-'] }]);
    expect(result.prices.map(p => [p.input.drink, p.input.volumeMl, p.input.priceChf])).toEqual([['coffee', null, 5.5], ['pizza', null, 18]]);
  });
  it('uses the printed medium coffee column, even when columns are reversed', () => {
    for (const sizes of [['S (2 dl)', 'M (3 dl)', 'L (4 dl)'], ['L (4 dl)', 'M (3 dl)', 'S (2 dl)']]) {
      const prices = sizes[0].startsWith('S') ? ['4.8', '5.3', '5.8'] : ['5.8', '5.3', '4.8'];
      const result = extract([{ ...row, name: 'Flat White', category: 'flat_white', sizes, prices }]);
      expect(result.prices.map(p => p.input)).toMatchObject([{ name: 'Flat White (M, 3 dl)', coffeeType: 'flat_white', priceChf: 5.3, volumeMl: null }]);
      expect(result.prices).toHaveLength(1);
    }
    expect(extract([{ ...row, name: 'Flat White', category: 'flat_white', sizes: ['S', 'M', 'L'], prices: ['4.8', '?', '5.8'] }]).prices).toEqual([]);
  });
  it('does not turn iced drinks, tea or extras into standard coffee', () => {
    for (const name of ['Iced Cappuccino', 'Iced Americano', 'Iced Matcha Latte', 'Chai Latte', 'Hot Chocolate', 'Extra shot', 'Espresso Macchiato']) {
      expect(extract([{ ...row, name, category: 'cappuccino', sizes: [''], prices: ['5.3'] }]).prices).toEqual([]);
    }
  });
  it.each([{ menu: false }, { wrongVenue: true }, { currency: 'other' }, { rows: null }])('rejects a non-matching document %j', patch => {
    expect(() => menuPrices({ ...document(), ...patch }, bar, '2026-10-16')).toThrow();
  });
});

describe('OCR calls and cost guard', () => {
  const image = { data: '/9j/2Q==', mediaType: 'image/jpeg' as const };
  it('validates the declared image type and size before sending it anywhere', () => {
    expect(validateScanImage(image)).toEqual(image);
    for (const value of [null, { ...image, data: 'not-an-image' }, { ...image, mediaType: 'image/png' }, { ...image, data: 'A'.repeat(2_700_000) }]) expect(() => validateScanImage(value)).toThrow();
  });
  it('keeps maximum input plus output cost inside the cap', () => {
    for (const input of [0, 1500, 3000, 5000, 9500, 50000]) expect((input + 256) * .1 / 1e6 + outputTokenBudget(input) * .5 / 1e6).toBeLessThanOrEqual(OCR_BUDGET_USD);
    for (const input of [NaN, -1, 50001]) expect(() => outputTokenBudget(input)).toThrow();
    expect(() => outputTokenBudget(5000, 0.0001)).toThrow();
  });
  it('automatically retries a cutoff with more output space and checks only the complete result', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ input_tokens: 3000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"menu":true,"rows":[{"name":"broken' }], usage: { input_tokens: 3000, output_tokens: 4096 } }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(document()) }], usage: { input_tokens: 3000, output_tokens: 100 } }))
      .mockResolvedValueOnce(Response.json({ input_tokens: 3000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ wrongVenue: false, venueEvidence: '', accepted: [0], rejected: [] }) }], usage: { input_tokens: 3000, output_tokens: 30 } }));
    const result = await readMenu(image, bar, 'test', fetcher);
    expect(menuPrices(result.parsed, bar, '2026-10-21').prices).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[0][0])).toContain('count_tokens');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).max_tokens).toBe(outputTokenBudget(3000));
    expect(JSON.parse(fetcher.mock.calls[2][1].body).max_tokens).toBe(8192);
    expect(result.usage).toMatchObject({ inputTokens: 9000, outputTokens: 4226 });
    expect(result.usage.costUsd).toBeLessThanOrEqual(OCR_BUDGET_USD);
  });
  it('checks a menu with more than forty rows in batches and maps rejections back correctly', async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ ...row, name: `Beer ${i}` }));
    const fetcher = vi.fn().mockImplementation(async (url, options) => {
      if (String(url).endsWith('count_tokens')) return Response.json({ input_tokens: 3000 });
      const body = JSON.parse(options.body);
      const text = body.messages[0].content[1].text;
      const candidates = text.startsWith('{') ? JSON.parse(text).candidates : undefined;
      const doc = candidates ? { wrongVenue: false, venueEvidence: '',
        accepted: candidates.filter((c: any) => c.row.name !== 'Beer 20').map((c: any) => c.id),
        rejected: candidates.filter((c: any) => c.row.name === 'Beer 20').map((c: any) => ({ id: c.id, reason: 'Unclear' })),
      } : document(rows);
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(doc) }] });
    });
    const result = await readMenu(image, bar, 'test', fetcher);
    const parsed = menuPrices(result.parsed, bar, '2026-10-21');
    expect(parsed.prices).toHaveLength(88);
    expect(parsed.skipped).toBe(1);
    expect(parsed.prices.some(p => p.input.name === 'Beer 20')).toBe(false);
    expect(parsed.prices.some(p => p.input.name === 'Beer 44')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it('bounds repeated cutoffs without accepting partial data', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ input_tokens: 3000 }))
      .mockImplementation(async () => Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: JSON.stringify(document()) }] }));
    await expect(readMenu(image, bar, 'test', fetcher)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    const reserved = fetcher.mock.calls.slice(1).reduce((sum, call) => sum + 3256 * .1 / 1e6 + JSON.parse(call[1].body).max_tokens * .5 / 1e6, 0);
    expect(reserved).toBeLessThanOrEqual(OCR_BUDGET_USD);
  });
  it('discards an extracted price if the image check rejects it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(document()) }], usage: { input_tokens: 2000, output_tokens: 100 } }))
      .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ wrongVenue: false, venueEvidence: '', accepted: [], rejected: [{ id: 0, reason: 'Price digit is unclear' }] }) }], usage: { input_tokens: 2000, output_tokens: 30 } }));
    const result = await readMenu(image, bar, 'test', fetcher);
    expect(menuPrices(result.parsed, bar, '2026-10-16').prices).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rejects an incomplete or contradictory verification instead of saving unchecked rows', async () => {
    for (const check of [{ accepted: [], rejected: [] }, { accepted: [0], rejected: [{ id: 0, reason: 'conflict' }] }, { accepted: [1], rejected: [] }]) {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
        .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(document()) }] }))
        .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
        .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ wrongVenue: false, venueEvidence: '', ...check }) }] }));
      await expect(readMenu(image, bar, 'test', fetcher)).rejects.toMatchObject({ status: 422 });
    }
  });
  it('never retries a failed paid request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ input_tokens: 2000 })).mockRejectedValueOnce(new Error('offline'));
    await expect(readMenu(image, bar, 'test', fetcher)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { wrongVenue: false, venueEvidence: '' },
    { wrongVenue: true, venueEvidence: 'Restaurant Anders, Bundesplatz 1, 3011 Bern' },
    { wrongVenue: true, venueEvidence: 'Mars Bar, Anderegasse 9, 4000 Basel' },
  ])('checks restaurant identity again in the existing verification pass: %j', async identity => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(document()) }] }))
      .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...identity, accepted: [0], rejected: [] }) }] }));
    const result = await readMenu(image, bar, 'test', fetcher);
    expect(result.parsed.wrongVenue).toBe(identity.wrongVenue);
    if (identity.wrongVenue) {
      expect(() => menuPrices(result.parsed, bar, '2026-10-16')).toThrow('anderen Lokal');
    } else {
      expect(menuPrices(result.parsed, bar, '2026-10-16').prices).toHaveLength(2);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    const verification = JSON.parse(fetcher.mock.calls[3][1].body);
    const supplied = JSON.parse(verification.messages[0].content[1].text);
    expect(supplied.selectedVenue).toEqual({ name: bar.name, address: bar.address, postcode: bar.postcode });
    expect(verification.system).toContain('supplier');
  });
  it.each([{}, { wrongVenue: true, venueEvidence: '' }, { wrongVenue: 'false', venueEvidence: '' }])('rejects missing or unsupported venue verification: %j', async identity => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(document()) }] }))
      .mockResolvedValueOnce(Response.json({ input_tokens: 2000 }))
      .mockResolvedValueOnce(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...identity, accepted: [0], rejected: [] }) }] }));
    await expect(readMenu(image, bar, 'test', fetcher)).rejects.toMatchObject({ status: 422 });
  });
});

describe('atomic, repeat-safe scan storage', () => {
  it('saves both sizes once, remembers the receipt and preserves AI attribution', async () => {
    const store = memoryStore(); await reserveScan(store, 'photo', 'visitor');
    const { prices, skipped } = extract();
    const result = await saveMenuScan(store, 'photo', bar, [], prices, skipped);
    expect(result.added).toBe(2);
    expect(result.entries.every(e => e.offer.confidence === 'ai' && e.offer.menuScan?.sha256 === 'photo')).toBe(true);
    expect((await reserveScan(store, 'photo', 'visitor'))?.entries).toEqual(result.entries);
    expect((await saveMenuScan(store, 'photo', bar, [], prices, skipped)).entries).toEqual(result.entries);
    expect((await store.read()).state.entries).toHaveLength(2);
    const empty = { generatedAt: '', discoveredAt: '', attribution: '', bars: [bar] };
    expect(applyEntries(empty, result.entries, [bar], 'beer').bars[0].offers.every(o => o.confidence === 'ai')).toBe(true);
  });
  it('deduplicates new photos and leaves existing conflicting prices untouched', async () => {
    const store = memoryStore(); const { prices } = extract();
    await reserveScan(store, 'one', 'visitor'); await saveMenuScan(store, 'one', bar, [], prices, 0);
    await reserveScan(store, 'two', 'visitor');
    const result = await saveMenuScan(store, 'two', bar, [], extract([{ ...row, prices: ['5.20', '9.00'] }]).prices, 0);
    expect(result).toMatchObject({ added: 0, unchanged: 1, conflicts: 1 });
    expect((await store.read()).state.entries.map(e => e.offer.priceChf)).toEqual([5.2, 7.9]);
  });
  it('does not overwrite a manually contributed price', async () => {
    const store = memoryStore(); const { state, etag } = await store.read();
    const offer = { ...extract().prices[0].input, confidence: 'community', evidence: '' } as Offer;
    state.entries.push({ id: 'manual', barId: bar.id, drink: 'beer', offer: { ...offer, priceChf: 6 }, targetKey: offerKey(offer), revision: 3, updatedAt: '' });
    await store.write(state, etag); await reserveScan(store, 'image', 'visitor');
    const result = await saveMenuScan(store, 'image', bar, [], extract().prices, 0);
    expect(result).toMatchObject({ added: 1, conflicts: 1 });
    expect((await store.read()).state.entries.find(e => e.id === 'manual')).toMatchObject({ revision: 3, offer: { priceChf: 6 } });
  });
  it('rejects inconsistent duplicate rows and preserves unrelated concurrent writes', async () => {
    const store = memoryStore(); await reserveScan(store, 'a', 'visitor'); await reserveScan(store, 'b', 'visitor');
    const conflicting = extract([row, { ...row, prices: ['5.50', '8.00'] }]).prices;
    const [a, b] = await Promise.all([saveMenuScan(store, 'a', bar, [], conflicting, 0), saveMenuScan(store, 'b', { ...bar, id: 'node/2' }, [], extract().prices, 0)]);
    expect(a).toMatchObject({ added: 0, conflicts: 2 }); expect(b.added).toBe(2);
    expect((await store.read()).state.entries).toHaveLength(2);
  });
  it('allows only one request to reserve an identical photo', async () => {
    const store = memoryStore();
    const results = await Promise.allSettled([reserveScan(store, 'same', 'a'), reserveScan(store, 'same', 'b')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await failScan(store, 'same');
    await expect(reserveScan(store, 'same', 'a')).rejects.toMatchObject({ status: 429 });
  });
  it('allows the same photo again after a short failed-scan cooldown and keeps charging attempt limits', async () => {
    const store = memoryStore(), now = 1000;
    await reserveScan(store, 'same', 'a', now);
    await failScan(store, 'same', now);
    await expect(reserveScan(store, 'same', 'a', now + 29999)).rejects.toMatchObject({ status: 429 });
    await expect(reserveScan(store, 'same', 'a', now + 30001)).resolves.toBeUndefined();
    expect((await store.read()).state.limits['scan:a'].count).toBe(2);
  });
  it('limits paid attempts across instances and expires the limit', async () => {
    const store = memoryStore(), now = 1000;
    for (let i = 0; i < 6; i++) await reserveScan(store, `photo-${i}`, 'a', now);
    await expect(reserveScan(store, 'blocked', 'a', now)).rejects.toMatchObject({ status: 429 });
    await expect(reserveScan(store, 'later', 'a', now + 3600001)).resolves.toBeUndefined();
  });
  it('never reports successful or partial storage when a write fails', async () => {
    const store = memoryStore(); await reserveScan(store, 'photo', 'visitor');
    store.write = async () => { throw new Error('offline'); };
    await expect(saveMenuScan(store, 'photo', bar, [], extract().prices, 0)).rejects.toThrow('offline');
    expect((await store.read()).state.entries).toEqual([]);
  });
  it('explains partial recognition and conflicts without asking for form fields', () => {
    expect(scanSummary({ entries: [], added: 2, unchanged: 1, conflicts: 1, skipped: 1 })).toContain('2 Preise gespeichert.');
    expect(scanSummary({ entries: [], added: 0, unchanged: 2, conflicts: 0, skipped: 0 })).toBe('Keine neuen Preise gespeichert. 2 bereits vorhanden.');
  });
});

describe('photo-backed targeted corrections', () => {
  it('updates the chosen offer with OCR evidence while unrelated prices remain untouched', async () => {
    const store = memoryStore();
    await reserveScan(store, 'initial', 'visitor');
    const initial = await saveMenuScan(store, 'initial', bar, [], extract().prices, 0);
    const target = initial.entries[0];
    await reserveScan(store, 'correction', 'visitor');
    const result = await saveMenuScan(store, 'correction', bar, [], extract([{ ...row, prices: ['9.20', '10.90'] }]).prices, 0,
      Date.now(), { id: target.id, revision: target.revision, targetKey: target.targetKey, drink: 'beer' });
    expect(result).toMatchObject({ updated: 1, conflicts: 1, added: 0 });
    expect(result.entries[0]).toMatchObject({ id: target.id, revision: 2, offer: { priceChf: 9.2, confidence: 'ai' } });
    const { state } = await store.read();
    expect(state.entries.find(item => item.id === initial.entries[1].id)?.offer.priceChf).toBe(7.9);
    expect(state.history).toEqual([target]);
    expect(state.priceChanges?.[0]).toMatchObject({ source: 'menu-scan', before: { priceChf: 5.2 }, after: { priceChf: 9.2 } });
  });
  it('corrects a catalogue offer and refuses missing evidence or stale revisions without partial saves', async () => {
    const store = memoryStore();
    const original = { ...extract().prices[0].input, confidence: 'ai', evidence: '' } as Offer;
    const edit = { revision: 0, targetKey: offerKey(original), drink: 'beer' as const };
    await reserveScan(store, 'missing', 'visitor');
    await expect(saveMenuScan(store, 'missing', bar, [original], extract([{ ...row, name: 'Other beer' }]).prices, 0, Date.now(), edit)).rejects.toHaveProperty('status', 422);
    expect((await store.read()).state.entries).toEqual([]);
    await reserveScan(store, 'valid', 'visitor');
    expect((await saveMenuScan(store, 'valid', bar, [original], extract([{ ...row, prices: ['9.20', '7.90'] }]).prices, 0, Date.now(), edit)).updated).toBe(1);
    await reserveScan(store, 'stale', 'visitor');
    await expect(saveMenuScan(store, 'stale', bar, [original], extract().prices, 0, Date.now(), edit)).rejects.toHaveProperty('status', 409);
  });
});
