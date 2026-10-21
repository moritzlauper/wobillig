import { expect, it, vi } from 'vitest';
// Operational scripts run directly in Node; exercise their storage and network boundaries.
// @ts-expect-error standalone operational script
import { backupCommunity, verifySnapshot } from '../scripts/community-snapshot.mjs';
// @ts-expect-error standalone operational script
import { checkSite } from '../scripts/site-health.mjs';
// @ts-expect-error standalone operational script
import { pendingSummary } from '../scripts/review-queue-check.mjs';
function storage() {
  const values = new Map<string, string>([['prices/production.json', JSON.stringify({ entries: [], history: [], limits: {}, mapOwners: { example: { browser: 'owner' } }, emailChallenges: { secret: 'code' }, securityCounters: { ip: 1 } })]]);
  return { values, get: vi.fn(async (path: string) => values.has(path) ? { statusCode: 200, stream: new Blob([values.get(path)!]).stream(), blob: { etag: 'version' } } : null), put: vi.fn(async (path: string, text: string, _options: Record<string, unknown>) => { values.set(path, text); }) };
}
it('stores a bounded private, verified backup while retaining ownership and excluding transient auth data', async () => {
  const s = storage(); const result = await backupCommunity(s, Date.UTC(2026, 9, 21));
  expect(result.path).toMatch(/^backups\/community\/v1\/slot-\d{2}\.json$/);
  expect(s.put.mock.calls[0][2]).toMatchObject({ access: 'private', addRandomSuffix: false, allowOverwrite: false });
  const snapshot = JSON.parse(s.values.get(result.path)!);
  expect(snapshot.cities[0].state.mapOwners).toBeDefined();
  expect(snapshot.cities[0].state.emailChallenges).toBeUndefined();
  expect(snapshot.cities[0].state.securityCounters).toBeUndefined();
  snapshot.cities[0].state.entries.push({ changed: true });
  expect(() => verifySnapshot(snapshot)).toThrow(/checksum/);
});
it('does not write a backup if a live read fails or required data disappears', async () => {
  const s = storage(); s.get.mockRejectedValueOnce(new Error('unavailable'));
  await expect(backupCommunity(s)).rejects.toThrow(); expect(s.put).not.toHaveBeenCalled();
  s.values.clear(); await expect(backupCommunity(s)).rejects.toThrow(); expect(s.put).not.toHaveBeenCalled();
});
it('protects snapshot replacement against concurrent writes and detects failed verification', async () => {
  const s = storage(); const now = Date.UTC(2026, 9, 21);
  await backupCommunity(s, now); await backupCommunity(s, now + 1000);
  expect(s.put.mock.calls[1][2]).toMatchObject({ ifMatch: 'version', allowOverwrite: true });
  s.put.mockImplementationOnce(async () => {});
  await expect(backupCommunity(s, now + 2000)).rejects.toThrow(/verification/);
});
it('health check retries temporary failures, rejects disabled protection and leaked private fields', async () => {
  const fetcher = vi.fn(async (url: URL) => new Response(url.pathname === '/' ? '<div id="app">' : url.pathname === '/impressum' ? 'Nussbaumstrasse 4' : url.pathname === '/datenschutz' ? 'Cloudflare' : JSON.stringify(url.pathname === '/api/community-auth' ? { protection: true, siteKey: 'site', paused: false } : { entries: [] })));
  fetcher.mockRejectedValueOnce(new Error('network'));
  expect(await checkSite('https://example.org', fetcher)).toBe(9);
  expect(fetcher).toHaveBeenCalledTimes(10);
  for (const bad of [{ protection: false, paused: false }, { entries: [], heldPrices: [] }]) {
    await expect(checkSite('https://example.org', async (url: URL) => url.pathname === (bad.entries ? '/api/prices' : '/api/community-auth') ? new Response(JSON.stringify(bad)) : fetcher(url))).rejects.toThrow(/Health check/);
  }
});
it('flags old and undated pending contributions without including private contents', () => {
  const now = Date.UTC(2026, 9, 21, 12);
  expect(pendingSummary({ heldPrices: [{ entry: { updatedAt: new Date(now - 25 * 3600000).toISOString() } }], pendingVenues: [{ submittedAt: new Date(now).toISOString() }], pendingCorrections: [{}] }, now)).toEqual({ pending: 3, overdue: 2 });
});
