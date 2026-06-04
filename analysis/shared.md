## 8. Shared Package (`packages/shared`)

### 8.1 Crypto Utilities

The shared crypto module targets the Web Crypto API, which is available in browser main threads, browser workers, and Chromium extension service workers. Node.js 18+ also exposes `globalThis.crypto.subtle`, so the same module can be unit-tested with Vitest without mocking.

The shared package exports two modules:
- `crypto.ts` — key derivation, encryption, decryption, password generation
- `password-validation.ts` — master password strength enforcement (see Section 3.3.3 for full implementation)

Key exports from `password-validation.ts`:
- `validateMasterPassword(password)` → `PasswordStrengthResult` (zxcvbn + HIBP + rules)
- `isBreachedPassword(password)` → `boolean` (HIBP k-anonymity check, client-side only)

```typescript
// packages/shared/src/crypto.ts
// hash-wasm provides argon2id in both browser and Node.js via bundled WASM.
// argon2-browser was spec-named but its WASM loader fails in Node.js/Vitest ESM
// (locateFile/__dirname issues). hash-wasm produces identical Argon2id output
// with the same parameters and tests exercise the exact production path.
import { argon2id as hashWasmArgon2id } from 'hash-wasm';

export interface EncryptedPayload {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

export async function deriveEncryptionKey(
  masterPassword: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const rawKey = await hashWasmArgon2id({
    password: masterPassword,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,  // 64 MiB — load-bearing, do not lower
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey(
    'raw',
    rawKey.buffer,
    { name: 'AES-GCM' },
    false,           // non-extractable
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(key: CryptoKey, plaintext: string): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { ciphertext, iv };
}

export async function decryptData(key: CryptoKey, payload: EncryptedPayload): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: payload.iv },
    key,
    payload.ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export async function hashLabel(label: string): Promise<string> {
  const encoded = new TextEncoder().encode(label.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generatePassword(options: PasswordOptions): string {
  const charsets: Record<string, string> = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.?',
  };
  const ambiguous = /[O0Il1]/g;
  let pool = Object.entries(charsets)
    .filter(([k]) => options[k as keyof PasswordOptions])
    .map(([, v]) => v)
    .join('');
  if (options.excludeAmbiguous) pool = pool.replace(ambiguous, '');
  const bytes = crypto.getRandomValues(new Uint8Array(options.length * 2));
  let result = '';
  for (const byte of bytes) {
    if (result.length >= options.length) break;
    // Rejection sampling to eliminate modulo bias
    if (byte < Math.floor(256 / pool.length) * pool.length)
      result += pool[byte % pool.length];
  }
  return result;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
  });
}
```

AES-GCM with a 12-byte random IV provides 96-bit IV space. For a vault that might hold 10,000 entries the collision probability is negligible (birthday bound for 96-bit nonces across 10^4 entries is approximately 3×10^-22). IV uniqueness is critical because AES-GCM authentication tag integrity breaks catastrophically on IV reuse with the same key.

The `generatePassword` function uses rejection sampling to eliminate modulo bias. The pool size rarely exceeds 90 characters, and 256 is not divisible by most pool sizes, so naive `byte % pool.length` over-represents low-index characters.

**Passphrase generation (`src/generator.ts` + `src/wordlist.ts`, added Phase 5 Step 4):**

- `generatePassphraseWords(words)` / `generatePassphrase({ words, separator = '-' })` pick diceware words from the **EFF large wordlist** (7776 words, log2(7776) ≈ 12.92 bits/word). The EFF short list (1296 words, 10.34 bits/word) was rejected: a 4-word passphrase would drop from ~51.7 to ~41.4 bits. This is a load-bearing security choice — changing the wordlist changes real entropy and requires the same review discipline as the Argon2id parameters.
- Sampling is CSPRNG (`crypto.getRandomValues` on `Uint32Array`) + rejection sampling (2^32 is not divisible by 7776), mirroring `generatePassword`. Never `Math.random`.
- The words-array variant exists because a few EFF words contain the default `-` separator (`t-shirt`, `drop-down`, `felt-tip`): UIs must never re-split the joined phrase.
- **Entropy helpers** `passwordEntropyBits(options)` / `passphraseEntropyBits(words)` compute bits from the actual pool: `buildPasswordPool(options)` is exported from `crypto.ts` (86 chars with all classes; 81 when `excludeAmbiguous` strips `O0Il1`) so UI entropy displays use the same constants the generator draws from and cannot drift.

### 8.2 Type Definitions

```typescript
// packages/shared/src/types.ts
export enum VaultEntryType {
  LOGIN       = 'LOGIN',
  NOTE        = 'NOTE',
  CARD        = 'CARD',
  IDENTITY    = 'IDENTITY',
  ENV_FILE    = 'ENV_FILE',   // .env file: multi-key encrypted blob
  SECRET      = 'SECRET',     // Single named secret: API key, token, cert PEM, etc.
}

export type Environment = 'production' | 'staging' | 'development' | string;

// Base interface shared by all entry types
export interface DecryptedEntry {
  id: string;
  type: VaultEntryType;
  label: string;
  updatedAt: Date;
  secretVersion: number;
  environment?: Environment;

  // LOGIN
  username?: string;
  password?: string;
  url?: string;
  notes?: string;

  // CARD
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardholderName?: string;

  // IDENTITY
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;

  // ENV_FILE — entire .env content stored as single encrypted string
  // Client parses to key=value pairs; server never sees individual keys
  envContent?: string;          // raw .env file text (newline-delimited KEY=VALUE)
  envParsed?: Record<string, string>;  // derived client-side from envContent, not stored

  // SECRET — single key/value (API key, token, certificate, SSH key, etc.)
  secretKey?: string;           // variable name / identifier, e.g. "STRIPE_SECRET_KEY"
  secretValue?: string;         // the secret value
  secretDescription?: string;   // optional human description
}

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; totpEnabled: boolean };
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}
```

These types are imported as path aliases (`@shared/types`) in the NestJS backend (type checking only — the backend never uses the crypto functions), the Nuxt frontend, and the extension. TypeScript project references in `tsconfig.json` at the workspace root ensure all packages see a consistent type surface.

---

