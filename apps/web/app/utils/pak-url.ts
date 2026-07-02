// Shared parser for `adyton://pak?d=<base64-json-payload>` URLs. Two capture paths
// produce the exact same string: the OS camera resolving a custom-scheme deep link
// (pak-deep-link.client.ts) and the in-app scanner reading a QR code's raw value
// (QrScannerOverlay.vue) — both call this one function so the routing logic can't drift.
export interface PakRoute {
  path: '/pak/enroll' | '/pak/approve';
  query: { d: string };
}

export function parsePakUrl(raw: string): PakRoute | null {
  if (!raw.startsWith('adyton://pak')) return null;

  let urlObj: URL;
  try {
    urlObj = new URL(raw);
  } catch {
    return null;
  }

  const d = urlObj.searchParams.get('d');
  if (!d) return null;

  // Peek at the mode field without fully validating the payload — the destination
  // page is responsible for thorough validation.
  let mode: string | undefined;
  try {
    const payload = JSON.parse(atob(d)) as Record<string, unknown>;
    mode = typeof payload['m'] === 'string' ? payload['m'] : undefined;
  } catch {
    // Malformed payload — default to approval, which will show an error.
  }

  return { path: mode === 'enroll' ? '/pak/enroll' : '/pak/approve', query: { d } };
}
