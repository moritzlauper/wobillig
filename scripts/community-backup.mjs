import { get } from '@vercel/blob';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Run with node --env-file=.env.local scripts/community-backup.mjs [directory].
// No credentials, email challenges or transient quota state are exported.
const directory = resolve(process.argv[2] || `output/community-backups/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
const manifest = { createdAt: new Date().toISOString(), files: [] };
for (const city of ['zurich', 'bern', 'basel', 'lausanne', 'geneva', 'winterthur']) {
  const path = `prices/${city === 'zurich' ? '' : `${city}/`}production.json`;
  const response = await get(path, { access: 'private', useCache: false });
  if (!response) { manifest.files.push({ city, path, missing: true }); continue; }
  if (response.statusCode !== 200) throw new Error(`Backup failed: ${city}`);
  const state = await new Response(response.stream).json();
  if (!Array.isArray(state.entries) || !Array.isArray(state.history)) throw new Error(`Invalid state: ${city}`);
  delete state.emailChallenges; delete state.securityCounters;
  const text = JSON.stringify(state, null, 2), filename = `${city}.json`;
  await writeFile(resolve(directory, filename), text, { mode: 0o600, flag: 'wx' });
  const reread = await readFile(resolve(directory, filename));
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (createHash('sha256').update(reread).digest('hex') !== sha256) throw new Error(`Backup verification failed: ${city}`);
  manifest.files.push({ city, path, filename, sha256, entries: state.entries.length });
}
await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
console.log(`Verified community backup: ${directory}`);
console.log(`${manifest.files.filter(file => !file.missing).length} city snapshots; checksums in manifest.json`);
