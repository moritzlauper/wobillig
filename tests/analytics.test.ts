import { describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
import { track } from '@vercel/analytics';
import { analyticsBeforeSend, trackEvent } from '../src/analytics';

describe('analytics isolation', () => {
  it('redacts search terms, selected venues and fragments on both event types', () => {
    for (const type of ['pageview', 'event'] as const) {
      const input = { type, url: 'https://wobillig.ch/en/bern?q=Private%20Address&bar=123#details' };
      expect(analyticsBeforeSend(input)).toEqual({ type, url: 'https://wobillig.ch/en/bern' });
      expect(input.url).toContain('Private');
    }
  });
  it('does not interrupt the user action when analytics throws', () => {
    vi.mocked(track).mockImplementationOnce(() => { throw new Error('Tracking blocked'); });
    expect(() => trackEvent('bern', 'venue_saved', {})).not.toThrow();
  });
});
