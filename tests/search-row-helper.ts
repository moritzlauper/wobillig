import type { Page } from '@playwright/test';

// On phones the venue search opens with the filters unless a search is active.
export async function showSearch(page: Page) {
  if (!await page.locator('#search').isVisible()) await page.locator('#filters-toggle').click();
}
