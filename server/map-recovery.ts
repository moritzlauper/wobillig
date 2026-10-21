import { createHmac, timingSafeEqual } from 'node:crypto';
import type { City } from '../src/cities.js';

// Issued by the operator only; knowing a public map ID is not proof of ownership.
export function validMapRecovery(token: unknown, city: City, mapId: string, now = Date.now()): boolean {
  const secret = process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret || typeof token !== 'string') return false;
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match || Number(match[1]) <= now || Number(match[1]) > now + 86400000) return false;
  const expected = createHmac('sha256', secret).update(`map-recovery:${city}:${mapId}:${match[1]}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[2], 'hex'));
}
