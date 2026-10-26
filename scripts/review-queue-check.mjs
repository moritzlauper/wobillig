import { pathToFileURL } from 'node:url';
import { get } from '@vercel/blob';

export function pendingSummary(state, now = Date.now()) {
  const timestamps = [
    ...(state.heldPrices || []).map(row => row.entry?.updatedAt),
    ...(state.pendingVenues || []).map(row => row.submittedAt),
    ...(state.pendingCorrections || []).map(row => row.submittedAt),
    ...(state.customMaps || []).filter(row => row.publication?.status === 'pending').map(row => row.publication.requestedAt || row.createdAt),
  ];
  const overdue = timestamps.filter(value => !Number.isFinite(Date.parse(value)) || now - Date.parse(value) >= 24 * 60 * 60 * 1000).length;
  return { pending: timestamps.length, overdue };
}
export async function checkReviewQueue(fetchBlob = get, now = Date.now()) {
  const totals = { pending: 0, overdue: 0 };
  for (const city of ['zurich', 'bern', 'basel', 'lausanne', 'geneva', 'winterthur']) {
    const r = await fetchBlob(`prices/${city === 'zurich' ? '' : city + '/'}production.json`, { access: 'private', useCache: false });
    if (!r) continue;
    if (r.statusCode !== 200) throw new Error('Review queue could not be read');
    const state = await new Response(r.stream).json();
    if (!Array.isArray(state.entries)) throw new Error('Invalid community state');
    const summary = pendingSummary(state, now);
    totals.pending += summary.pending; totals.overdue += summary.overdue;
  }
  return totals;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await checkReviewQueue();
    console.log(`Pending reviews: ${summary.pending}; waiting at least 24 hours or missing a timestamp: ${summary.overdue}.`);
    console.log('Review privately at https://wobillig.ch/api/community-review and /api/map-review.');
    if (summary.overdue || summary.pending >= 100) process.exitCode = 1;
  } catch { console.error('Review queue monitoring failed. No contribution details are logged.'); process.exitCode = 1; }
}
