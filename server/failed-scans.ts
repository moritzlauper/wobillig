import { randomUUID } from 'node:crypto';
import { del, get, put } from '@vercel/blob';
import type { City } from '../src/cities.js';
import { InputError } from '../src/community.js';
import { WriteConflict, type Store } from './prices.js';
import type { ScanImage } from './menu-ocr.js';

// A menu photo the scan could not turn into prices. The user is thanked instead of
// shown an error; the photo waits on the review page until someone enters its prices.
export type FailedScanReason = 'unreadable' | 'no_prices' | 'wrong_venue' | 'limit' | 'unavailable' | 'invalid';
export type FailedScan = { id: string; barId: string; venue: string; reason: FailedScanReason; message: string; at: string; path: string; mediaType: ScanImage['mediaType'] };
const MAX_KEPT = 300;

export function failedScanReason(status: number, message: string): FailedScanReason {
  if (/anderen Lokal/.test(message)) return 'wrong_venue';
  if (/Keine eindeutigen/.test(message)) return 'no_prices';
  if (status === 429) return 'limit';
  if (status === 503) return 'unavailable';
  return status === 422 ? 'unreadable' : 'invalid';
}

export async function keepFailedScan(store: Store, city: City, image: ScanImage, venue: { id: string; name: string; address?: string } | undefined,
  barId: unknown, reason: FailedScanReason, message: string, now = Date.now()): Promise<FailedScan> {
  const id = randomUUID();
  const path = `failed-scans/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}/${city}/${id}.${image.mediaType === 'image/png' ? 'png' : 'jpg'}`;
  await put(path, Buffer.from(image.data, 'base64'), { access: 'private', contentType: image.mediaType, addRandomSuffix: false });
  const row: FailedScan = { id, barId: typeof barId === 'string' ? barId.slice(0, 200) : '', venue: venue ? [venue.name, venue.address].filter(Boolean).join(', ') : 'Unbekanntes Lokal',
    reason, message: message.slice(0, 300), at: new Date(now).toISOString(), path, mediaType: image.mediaType };
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await store.read();
    const kept = [...(state.failedScans || []), row];
    // The oldest photos give way when the list is full, so storage stays bounded.
    const dropped = kept.slice(0, Math.max(0, kept.length - MAX_KEPT));
    state.failedScans = kept.slice(-MAX_KEPT);
    try {
      await store.write(state, etag);
      await Promise.all(dropped.map(old => del(old.path).catch(() => undefined)));
      return row;
    } catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Das Foto konnte gerade nicht gespeichert werden.', 503);
}

export async function failedScanPhoto(store: Store, id: string) {
  const row = (await store.read()).state.failedScans?.find(item => item.id === id);
  if (!row) throw new InputError('Foto nicht gefunden.', 404);
  const result = await get(row.path, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new InputError('Foto nicht gefunden.', 404);
  return { row, stream: result.stream };
}

export async function dismissFailedScan(store: Store, id: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await store.read();
    const row = state.failedScans?.find(item => item.id === id);
    if (!row) return;
    state.failedScans = state.failedScans!.filter(item => item.id !== id);
    try { await store.write(state, etag); await del(row.path).catch(() => undefined); return; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Bitte erneut versuchen.', 409);
}
