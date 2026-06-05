// Vault entry types — fixed enum, must match apps/api EntryType exactly.
// Adding a type requires shared + migration + UI changes.
export enum VaultEntryType {
  LOGIN        = 'LOGIN',
  SECURE_NOTE  = 'SECURE_NOTE',
  CREDIT_CARD  = 'CREDIT_CARD',
  IDENTITY     = 'IDENTITY',
  ENV_FILE     = 'ENV_FILE',
  SECRET       = 'SECRET',
}

export type EnvironmentTag = 'production' | 'staging' | 'development' | 'custom';

export interface DecryptedEntry {
  id: string;
  type: VaultEntryType;
  label: string;
  createdAt: Date;
  updatedAt: Date;
  secretVersion: number;
  environment?: EnvironmentTag;

  // LOGIN
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  totpSecret?: string; // base32 TOTP seed (RFC 6238) — rides the encrypted blob, never structural

  // CREDIT_CARD
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardholderName?: string;

  // IDENTITY
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;

  // ENV_FILE — entire .env stored as single encrypted string
  envContent?: string;
  envParsed?: Record<string, string>; // derived client-side, never stored

  // SECRET — single named key/value pair
  secretKey?: string;
  secretValue?: string;
  secretDescription?: string;
}

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface PassphraseOptions {
  words: number;       // integer, 1–20
  separator?: string;  // default '-'
}

// Per-user settings — persisted server-side (users.settings JSONB) so they sync
// across devices/browsers (extension Phase 7, mobile Phase 9). NON-SECRET behavioral
// metadata only (like environmentTag): never store secrets or key material here.
// Client keeps a localStorage boot cache; the DB is authoritative (last-write-wins).
export type LockMode = 'activity' | 'absolute';

export interface UserSettings {
  displayName: string;
  lockMode: LockMode;       // 'activity' resets the timer on user activity; 'absolute' never resets
  lockDurationMs: number;   // 0 = never auto-lock, otherwise LOCK_DURATION_MIN_MS..LOCK_DURATION_MAX_MS
}

export const LOCK_DURATION_MIN_MS = 60_000;     // 1 min
export const LOCK_DURATION_MAX_MS = 3_600_000;  // 60 min

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  displayName: '',
  lockMode: 'activity',
  lockDurationMs: 15 * 60_000,
});

// Aligned to actual API response (login/register/refresh).
// Note: masterPassword is NOT transmitted to server for key derivation — kdfSalt
// enables client-side Argon2id derivation of the vault key independently from auth.
export interface AuthTokens {
  accessToken: string;
  user: {
    id: string;
    email: string;
    kdfSalt: string; // 64-char hex (32 random bytes), returned in all auth responses
    totpEnabled: boolean;
  };
  newDeviceOtp?: string; // present only on new-device login/register
}

// First-stage login outcome for a 2FA-enabled account: no tokens are issued.
// mfaToken is an opaque single-use value (5 min TTL) consumed by POST /auth/2fa/authenticate.
export interface MfaRequired {
  requiresMfa: true;
  mfaToken: string;
}

export type LoginResponse = AuthTokens | MfaRequired;

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
