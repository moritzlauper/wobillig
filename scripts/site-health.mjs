import { pathToFileURL } from 'node:url';

const privateFields = ['heldPrices', 'mapOwners', 'emailChallenges', 'securityCounters', 'history', 'limits', 'coffeeVoteDetails'];
export async function checkSite(base = 'https://wobillig.ch', fetcher = fetch) {
  const checks = [
    ['/', text => text.includes('id="app"')],
    ['/impressum', text => text.includes('Nussbaumstrasse 4')],
    ['/datenschutz', text => text.includes('Cloudflare')],
    ['/api/community-auth', text => { const c = JSON.parse(text); return c.protection === true && Boolean(c.siteKey) && c.paused === false; }],
    ...['zurich', 'bern', 'basel', 'lausanne', 'geneva', 'winterthur'].map(city => [`/api/prices?city=${city}&view=public`, text => {
      const data = JSON.parse(text);
      return Array.isArray(data.entries) && !privateFields.some(key => key in data);
    }]),
  ];
  for (const [path, valid] of checks) {
    let passed = false;
    for (let attempt = 0; attempt < 3 && !passed; attempt++) {
      try {
        const response = await fetcher(new URL(path, base), { signal: AbortSignal.timeout(15000) });
        passed = response.ok && valid(await response.text());
      } catch { /* Retry a transient network error without logging response data. */ }
    }
    if (!passed) throw new Error(`Health check failed: ${path}`);
  }
  return checks.length;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`${await checkSite(process.argv[2])} production checks passed.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
