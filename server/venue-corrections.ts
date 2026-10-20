import { communityVenues, InputError } from '../src/community.js';
import { validateVenueCorrection, type VenueCorrection } from '../src/venue-corrections.js';
import { WriteConflict, type Store } from './prices.js';

export async function saveVenueCorrection(store: Store, value: unknown, datasets: Parameters<typeof communityVenues>[0], visitor: string, now = Date.now()) {
  const input = validateVenueCorrection(value);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const venue = communityVenues(datasets, state.entries, state.venues, state.venueCorrections).find(bar => bar.id === input.barId);
    if (!venue) throw new InputError('Dieses Lokal ist nicht mehr verfügbar. Bitte neu laden.', 404);
    const old = state.venueCorrections?.find(correction => correction.barId === input.barId);
    // A retry after a lost response is successful only if the requested values still match.
    if (old && Object.entries(input.changes).every(([key, value]) => venue[key as keyof typeof venue] === value)) return { correction: old };
    if ((old?.revision || 0) !== input.revision) throw new InputError('Dieses Lokal wurde inzwischen geändert. Bitte neu laden und die Korrektur erneut prüfen.', 409);
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, limit]) => limit.expires > now));
    const key = `venue-correction:${visitor}`;
    const limit = state.limits[key] || { count: 0, expires: now + 3600000 };
    if (limit.count >= 20) throw new InputError('Zu viele Einträge. Bitte in einer Stunde erneut versuchen.', 429);
    state.limits[key] = { ...limit, count: limit.count + 1 };
    const correction: VenueCorrection = { barId: input.barId, changes: { ...old?.changes, ...input.changes },
      revision: (old?.revision || 0) + 1, updatedAt: new Date(now).toISOString() };
    state.venueCorrections = [...(state.venueCorrections || []).filter(item => item.barId !== input.barId), correction];
    state.venueCorrectionHistory = [...(state.venueCorrectionHistory || []), { correction, before: {
      name: venue.name, address: venue.address, postcode: venue.postcode, website: venue.website,
    } }];
    try { await store.write(state, etag); return { correction }; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden weitere Lokale gespeichert. Bitte erneut versuchen.', 409);
}
