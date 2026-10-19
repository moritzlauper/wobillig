import { track, type BeforeSendEvent } from '@vercel/analytics';
import type { City } from './cities';
import type { Drink } from './community';
import { locale } from './i18n';

type PriceAction = { category: Drink; action: 'add' | 'edit' };
type Events = {
  price_form_opened: PriceAction;
  price_submitted: PriceAction;
  price_saved: PriceAction;
  price_failed: PriceAction & { stage: 'validation' | 'request' };
  menu_upload_started: Record<string, never>;
  menu_upload_completed: { added: number; unchanged: number; conflicts: number; skipped: number };
  menu_upload_failed: { stage: 'preparation' | 'request' };
  venue_form_opened: Record<string, never>;
  venue_submitted: Record<string, never>;
  venue_saved: Record<string, never>;
  venue_existing_selected: Record<string, never>;
  venue_failed: { stage: 'validation' | 'request' };
  category_changed: { category: Drink };
  cheap_filter_changed: { category: Drink; enabled: boolean };
  venue_shared: { category: Drink; result: 'shared' | 'copied' | 'manual' | 'cancelled' };
  data_downloaded: { format: 'csv' | 'json' };
};

// Only aggregate attributes: never pass forms, filenames, URLs or error messages.
export function trackEvent<K extends keyof Events>(city: City, name: K, data: Events[K]) {
  try { track(name, { ...data, city, language: locale() }); }
  catch { /* Analytics must never interrupt saving, uploading or sharing. */ }
}

// Search terms and selected venues can appear in the URL attached by the SDK.
export function analyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  url.search = ''; url.hash = '';
  return { ...event, url: url.href };
}
