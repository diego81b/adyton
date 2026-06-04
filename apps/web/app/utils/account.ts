// Wire types for the sessions/devices/account endpoints — mirror the API response
// DTOs exactly (sessions/dto/session-summary.response.dto.ts and
// devices/dto/trusted-device.response.dto.ts). Dates arrive as ISO strings.
export interface ApiSession {
  id: string;
  familyId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApiTrustedDevice {
  id: string;
  deviceIdHash: string;
  userAgent: string;
  ipAddress: string;
  lastSeenAt: string | null;
  createdAt: string;
}

// Light user-agent labelling — enough for "Firefox · Windows"-style rows without
// shipping a UA-parser dependency. Falls back to the raw string.
const BROWSERS: Array<[RegExp, string]> = [
  [/edg(e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/firefox\//i, 'Firefox'],
  [/chrome\//i, 'Chrome'],
  [/safari\//i, 'Safari'],
];

const PLATFORMS: Array<[RegExp, string]> = [
  [/windows/i, 'Windows'],
  [/android/i, 'Android'],
  [/iphone|ipad|ios/i, 'iOS'],
  [/mac os|macintosh/i, 'macOS'],
  [/linux/i, 'Linux'],
];

export function describeUserAgent(ua: string): string {
  if (!ua) return 'Unknown device';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const platform = PLATFORMS.find(([re]) => re.test(ua))?.[1];
  if (browser && platform) return `${browser} · ${platform}`;
  if (browser || platform) return (browser ?? platform)!;
  return ua.length > 48 ? `${ua.slice(0, 48)}…` : ua;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}
