import { createHmac } from 'node:crypto';
import { get } from '@vercel/blob';

// Operator-only: issue a private link after confirming who created a legacy map.
// node --env-file=.env.local scripts/map-recovery.mjs zurich MAP_ID
const [city, mapId, ...extra] = process.argv.slice(2);
if (extra.length || !['zurich', 'bern', 'basel', 'lausanne', 'geneva', 'winterthur', 'olten'].includes(city) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mapId || '')) {
  throw new Error('Aufruf: node --env-file=.env.local scripts/map-recovery.mjs STADT MAP_ID');
}
const secret = process.env.BLOB_READ_WRITE_TOKEN;
if (!secret) throw new Error('BLOB_READ_WRITE_TOKEN fehlt.');
const result = await get(`prices/${city === 'zurich' ? '' : `${city}/`}production.json`, { access: 'private', useCache: false });
if (!result || result.statusCode !== 200) throw new Error('Maps konnten nicht geladen werden.');
const state = await new Response(result.stream).json();
if (!state.customMaps?.some(map => map.id === mapId)) throw new Error('Map nicht gefunden.');
if (state.mapOwners?.[mapId]) throw new Error('Diese Map hat bereits einen Besitzer. Keine Wiederherstellung für alte Maps nötig.');
const expires = Date.now() + 86400000;
const signature = createHmac('sha256', secret).update(`map-recovery:${city}:${mapId}:${expires}`).digest('hex');
const url = new URL(city === 'zurich' ? '/' : city === 'geneva' ? '/geneve' : `/${city}`, 'https://wobillig.ch');
url.searchParams.set('map', mapId);
url.hash = `recover=${expires}.${signature}`;
console.log('Privater Wiederherstellungslink (24 Stunden gültig). Nur an den bestätigten Ersteller weitergeben:');
console.log(url.href);
