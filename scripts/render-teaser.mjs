import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../public/teaser/wobillig-teaser-wordmark.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1180, height: 822 }, deviceScaleFactor: scale });
    await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);
    await page.screenshot({ path: new URL(`../public/teaser/wobillig-teaser-wordmark-${1180 * scale}.png`, import.meta.url).pathname });
    await page.close();
  }
} finally {
  await browser.close();
}
