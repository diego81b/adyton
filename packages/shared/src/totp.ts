// RFC 6238 TOTP generator (HMAC-SHA-1) for per-entry 2FA codes, computed
// entirely client-side from a stored base32 seed (like 1Password's built-in
// authenticator). No network, no server involvement.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * RFC 4648 base32 decode. Tolerates lowercase and whitespace; strips `=`
 * padding. Throws on any character outside the base32 alphabet.
 */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const cleaned = input.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');

  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: '${char}'`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  const bytes = new Uint8Array(new ArrayBuffer(output.length));
  bytes.set(output);
  return bytes;
}

export interface TotpOptions {
  digits?: number;
  period?: number;
  /** Epoch time in MILLISECONDS. Defaults to Date.now(). */
  timestamp?: number;
}

/**
 * RFC 6238 TOTP code. Algorithm HMAC-SHA-1, default 6 digits / 30s period.
 * `timestamp` is epoch milliseconds. Returns the zero-padded digit string.
 */
export async function generateTotp(
  secretBase32: string,
  opts: TotpOptions = {},
): Promise<string> {
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;
  const timestamp = opts.timestamp ?? Date.now();

  const counter = Math.floor(Math.floor(timestamp / 1000) / period);

  // 8-byte big-endian counter. Use two 32-bit halves to stay safe past 2^32s.
  const counterBytes = new Uint8Array(8);
  let hi = Math.floor(counter / 0x100000000);
  let lo = counter >>> 0;
  for (let i = 7; i >= 4; i--) {
    counterBytes[i] = lo & 0xff;
    lo = Math.floor(lo / 256);
  }
  for (let i = 3; i >= 0; i--) {
    counterBytes[i] = hi & 0xff;
    hi = Math.floor(hi / 256);
  }

  const keyBytes = base32Decode(secretBase32);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, counterBytes);
  const hmac = new Uint8Array(sigBuffer);

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const binary =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

/**
 * Seconds remaining until the current code rotates.
 * `timestamp` is epoch milliseconds.
 */
export function totpRemainingSeconds(period = 30, timestamp = Date.now()): number {
  return period - (Math.floor(timestamp / 1000) % period);
}
