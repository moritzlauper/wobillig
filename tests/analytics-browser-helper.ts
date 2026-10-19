import { expect, type Page } from '@playwright/test';

type Event = { name: string; data: Record<string, string | number | boolean> };
export async function captureAnalytics(page: Page) {
  await page.route('https://va.vercel-scripts.com/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**/_vercel/insights/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('https://gc.zgo.at/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.addInitScript(() => {
    const events: unknown[] = [];
    Object.assign(window, { analyticsEvents: events, va: (type: string, payload: unknown) => {
      if (type === 'event') events.push(payload);
    } });
  });
}
export const events = (page: Page): Promise<Event[]> => page.evaluate(() => (window as unknown as { analyticsEvents: Event[] }).analyticsEvents);
export async function expectEvent(page: Page, name: string, data: Event['data']) {
  await expect.poll(async () => (await events(page)).filter(event => event.name === name).map(event => event.data)).toContainEqual(data);
}
