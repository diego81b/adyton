import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeUserAgent, relativeTime } from '../../app/utils/account';

describe('describeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/125.0 Safari/537.36', 'Chrome · Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Firefox/124.0', 'Firefox · Linux'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Version/17.4 Safari/605.1', 'Safari · iOS'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/125.0 Edg/125.0', 'Edge · Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17 Safari/605', 'Safari · macOS'],
  ])('labels %s as %s', (ua, label) => {
    expect(describeUserAgent(ua)).toBe(label);
  });

  it('falls back to the (truncated) raw string and handles empty', () => {
    expect(describeUserAgent('')).toBe('Unknown device');
    expect(describeUserAgent('curl/8.0')).toBe('curl/8.0');
    const long = 'x'.repeat(60);
    expect(describeUserAgent(long)).toHaveLength(49); // 48 + ellipsis
  });
});

describe('relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('formats null, just-now, minutes, hours, and days', () => {
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime('2026-06-04T11:59:40.000Z')).toBe('just now');
    expect(relativeTime('2026-06-04T11:45:00.000Z')).toBe('15 minutes ago');
    expect(relativeTime('2026-06-04T09:00:00.000Z')).toBe('3 hours ago');
    expect(relativeTime('2026-06-01T12:00:00.000Z')).toBe('3 days ago');
    expect(relativeTime('2026-06-05T12:00:00.000Z')).toBe('tomorrow');
  });
});
