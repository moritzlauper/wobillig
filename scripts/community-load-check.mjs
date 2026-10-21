import { performance } from 'node:perf_hooks';
// Read-only smoke/load check; deliberately bounded to 40 requests, 8 at a time.
const base = new URL(process.argv[2] || 'http://127.0.0.1:5173');
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Expected HTTP(S) URL');
const endpoint = new URL('/api/prices?city=zurich&view=public', base);
const results = [];
for (let batch = 0; batch < 5; batch++) {
  results.push(...await Promise.all(Array.from({ length: 8 }, async () => {
    const start = performance.now();
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.entries) || ['heldPrices', 'mapOwners', 'emailChallenges', 'securityCounters'].some(key => key in body)) throw new Error(`Unexpected response: ${response.status}`);
    return { ms: Math.round(performance.now() - start), cache: response.headers.get('x-vercel-cache') };
  })));
}
const times = results.map(row => row.ms).sort((a, b) => a - b);
console.log(JSON.stringify({ requests: results.length, concurrency: 8, medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * .95) - 1], cacheHits: results.filter(row => row.cache === 'HIT').length }, null, 2));
