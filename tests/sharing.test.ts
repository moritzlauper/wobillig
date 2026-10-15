import { describe, expect, it, vi } from 'vitest';
import { barLink, shareLink } from '../src/sharing';

describe('bar links', () => {
  it('keeps the deployment path and bar ID without unrelated URL state', () => {
    const url = new URL(barLink('https://example.com/wobillig/?bar=node%2F1&drink=coffee&utm_source=test#old', 'way/123', 'beer', '500'));
    expect(url.pathname).toBe('/wobillig/');
    expect([...url.searchParams]).toEqual([['bar', 'way/123'], ['size', '500']]);
    expect(url.hash).toBe('');
  });
  it('preserves bottled beer and its portion when sharing', () => {
    const url = new URL(barLink('https://example.com/', 'node/2', 'beer', 'all', 'bottle'));
    expect(url.searchParams.get('size')).toBe('all');
    expect(url.searchParams.get('beerType')).toBe('bottle');
  });
  it('preserves coffee and Stange entry points', () => {
    const coffee = new URL(barLink('https://example.com/', 'node/2', 'coffee', 'stange'));
    expect(coffee.searchParams.get('drink')).toBe('coffee');
    expect(coffee.searchParams.has('size')).toBe(false);
    const beer = new URL(barLink('https://example.com/', 'node/2', 'beer', 'stange'));
    expect(beer.searchParams.get('size')).toBe('stange');
  });
});

describe('native sharing', () => {
  const data = { title: 'AYA · wobillig', url: 'https://example.com/?bar=node%2F123' };
  it('opens native sharing immediately and does not copy when sharing succeeds', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    const result = shareLink(data, { share, clipboard: { writeText } });
    expect(share).toHaveBeenCalledWith(data);
    expect(await result).toBe('shared');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('leaves the clipboard alone when the user cancels', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const writeText = vi.fn();
    expect(await shareLink(data, { share, clipboard: { writeText } })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('copies the bar URL when native sharing is unavailable or fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
    const share = vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
    expect(await shareLink(data, { share, clipboard: { writeText } })).toBe('copied');
  });
  it('offers a selectable link if clipboard access is unavailable or denied', async () => {
    expect(await shareLink(data, {})).toBe('manual');
    const writeText = vi.fn().mockRejectedValue(new Error('Denied'));
    expect(await shareLink(data, { clipboard: { writeText } })).toBe('manual');
  });
});
