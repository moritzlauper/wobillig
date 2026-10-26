import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { get, put } from '@vercel/blob';

const cityNames = ['zurich', 'bern', 'basel', 'lausanne', 'geneva', 'winterthur'];
const slotMs = 6 * 60 * 60 * 1000;
const digest = text => createHash('sha256').update(text).digest('hex');
export function verifySnapshot(snapshot) {
  if (snapshot.version !== 1 || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Array.isArray(snapshot.cities) || snapshot.cities.length !== cityNames.length) throw new Error('Invalid snapshot manifest');
  snapshot.cities.forEach((item, index) => {
    if (item.city !== cityNames[index]) throw new Error('Invalid snapshot city');
    if (item.missing === true) {
      if (item.city === 'zurich' || item.state !== undefined) throw new Error('Invalid missing city');
      return;
    }
    if (!Array.isArray(item.state?.entries) || !Array.isArray(item.state?.history) || !item.state.limits || 'emailChallenges' in item.state || 'securityCounters' in item.state || digest(JSON.stringify(item.state)) !== item.sha256) throw new Error('Snapshot checksum or schema mismatch');
  });
  return snapshot;
}
async function readJson(storage, path) {
  const response = await storage.get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
  if (!response) return null;
  if (response.statusCode !== 200) throw new Error('Private storage read failed');
  return { value: await new Response(response.stream).json(), etag: response.blob.etag };
}
export async function backupCommunity(storage = { get, put }, now = Date.now()) {
  const snapshot = { version: 1, createdAt: new Date(now).toISOString(), cities: [] };
  for (const city of cityNames) {
    const result = await readJson(storage, `prices/${city === 'zurich' ? '' : city + '/'}production.json`);
    if (!result) { snapshot.cities.push({ city, missing: true }); continue; }
    const state = result.value;
    delete state.emailChallenges; delete state.securityCounters;
    snapshot.cities.push({ city, state, sha256: digest(JSON.stringify(state)) });
  }
  verifySnapshot(snapshot);
  // A bounded private ring: four snapshots daily, 32 slots = eight days.
  // Upload one complete snapshot atomically; no public artifacts or live-state writes.
  const slot = Math.floor(now / slotMs) % 32;
  const path = `backups/community/v1/slot-${String(slot).padStart(2, '0')}.json`;
  const previous = await readJson(storage, path);
  const text = JSON.stringify(snapshot);
  await storage.put(path, text, { access: 'private', contentType: 'application/json', addRandomSuffix: false,
    allowOverwrite: Boolean(previous), ...(previous ? { ifMatch: previous.etag } : {}), cacheControlMaxAge: 60 });
  const saved = await readJson(storage, path);
  if (!saved || digest(JSON.stringify(verifySnapshot(saved.value))) !== digest(text)) throw new Error('Remote backup verification failed');
  return { path, createdAt: snapshot.createdAt, cities: snapshot.cities.filter(city => !city.missing).length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log('Verified private snapshot:', JSON.stringify(await backupCommunity())); }
  catch { console.error('Private community backup failed. No live community data was modified.'); process.exitCode = 1; }
}
