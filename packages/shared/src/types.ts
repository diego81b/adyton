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
