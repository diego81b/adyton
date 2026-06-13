import { VaultEntryType, type DecryptedEntry, type EnvironmentTag } from '@adyton/shared';
import { detectEnvFormat } from './vault-crypto';

export interface TypeMeta {
  /** Short human label for badge + filter chip. */
  label: string;
  /** lucide icon name. */
  icon: string;
  /** NuxtUI badge color token. */
  color: 'primary' | 'info' | 'success' | 'warning' | 'error' | 'neutral';
}

export const TYPE_META: Record<VaultEntryType, TypeMeta> = {
  [VaultEntryType.LOGIN]: { label: 'Login', icon: 'i-lucide-globe', color: 'info' },
  [VaultEntryType.ENV_FILE]: { label: 'Env File', icon: 'i-lucide-file-text', color: 'success' },
  [VaultEntryType.SECRET]: { label: 'Secret', icon: 'i-lucide-key', color: 'primary' },
  [VaultEntryType.SECURE_NOTE]: { label: 'Note', icon: 'i-lucide-sticky-note', color: 'warning' },
  [VaultEntryType.CREDIT_CARD]: { label: 'Card', icon: 'i-lucide-credit-card', color: 'error' },
  [VaultEntryType.IDENTITY]: { label: 'Identity', icon: 'i-lucide-user', color: 'neutral' },
};

// Static, purge-safe class strings per ENTRY TYPE (dynamic `bg-${color}` would be
// stripped by Tailwind — same trap that bit the step-0 strength meter). Keyed by type
// and aligned with CHIP_ACTIVE_CLASS below so the icon tiles and the filter chips
// share one well-separated palette (semantic tokens made SECRET/ENV/IDENTITY all
// green-ish — too similar to tell apart at a glance).
// Each tile is theme-adaptive: *-700 text on a faint *-500 tint in light mode
// (≥4.5:1 on white), *-300 text on a *-400 tint in dark mode. The old dark-only
// strings (`text-*-300` on every theme) were illegible on light surfaces.
export const TILE_CLASS: Record<VaultEntryType, string> = {
  [VaultEntryType.LOGIN]:
    'bg-blue-500/10 border-blue-500/25 text-blue-700 dark:bg-blue-400/10 dark:border-blue-400/20 dark:text-blue-300',
  [VaultEntryType.ENV_FILE]:
    'bg-orange-500/10 border-orange-500/25 text-orange-700 dark:bg-orange-400/10 dark:border-orange-400/20 dark:text-orange-300',
  [VaultEntryType.SECRET]:
    'bg-red-500/10 border-red-500/25 text-red-700 dark:bg-red-400/10 dark:border-red-400/20 dark:text-red-300',
  [VaultEntryType.SECURE_NOTE]:
    'bg-yellow-500/10 border-yellow-500/25 text-yellow-700 dark:bg-yellow-400/10 dark:border-yellow-400/20 dark:text-yellow-300',
  [VaultEntryType.CREDIT_CARD]:
    'bg-purple-500/10 border-purple-500/25 text-purple-700 dark:bg-purple-400/10 dark:border-purple-400/20 dark:text-purple-300',
  [VaultEntryType.IDENTITY]:
    'bg-teal-500/10 border-teal-500/25 text-teal-700 dark:bg-teal-400/10 dark:border-teal-400/20 dark:text-teal-300',
};

// Filter chips, in display order (mockup order). 'all' is handled separately.
export const TYPE_FILTERS: { type: VaultEntryType; label: string }[] = [
  { type: VaultEntryType.LOGIN, label: 'Login' },
  { type: VaultEntryType.ENV_FILE, label: 'Env File' },
  { type: VaultEntryType.SECRET, label: 'Secret' },
  { type: VaultEntryType.SECURE_NOTE, label: 'Note' },
  { type: VaultEntryType.CREDIT_CARD, label: 'Card' },
  { type: VaultEntryType.IDENTITY, label: 'Identity' },
];

// Per-chip ACTIVE style — DERIVED from TILE_CLASS so filter chips and icon tiles can
// never drift apart in tone (they used to: mockup chips were `*-900/40`, tiles
// `*-400/10`). 'all' uses the brand accent in the same tinted-tile shape.
export type ChipKey = VaultEntryType | 'all';
export const CHIP_ACTIVE_CLASS: Record<ChipKey, string> = {
  all: 'border bg-primary/10 border-primary/20 text-primary',
  [VaultEntryType.LOGIN]: `border ${TILE_CLASS[VaultEntryType.LOGIN]}`,
  [VaultEntryType.ENV_FILE]: `border ${TILE_CLASS[VaultEntryType.ENV_FILE]}`,
  [VaultEntryType.SECRET]: `border ${TILE_CLASS[VaultEntryType.SECRET]}`,
  [VaultEntryType.SECURE_NOTE]: `border ${TILE_CLASS[VaultEntryType.SECURE_NOTE]}`,
  [VaultEntryType.CREDIT_CARD]: `border ${TILE_CLASS[VaultEntryType.CREDIT_CARD]}`,
  [VaultEntryType.IDENTITY]: `border ${TILE_CLASS[VaultEntryType.IDENTITY]}`,
};
const CHIP_INACTIVE_CLASS = 'bg-elevated border border-default text-muted hover:text-highlighted';

/** Resolve the chip class for a given filter key and active state. */
export function chipClass(key: ChipKey, active: boolean): string {
  return active ? CHIP_ACTIVE_CLASS[key] : CHIP_INACTIVE_CLASS;
}

export const ENVIRONMENT_META: Record<EnvironmentTag, { label: string; dot: string }> = {
  production: { label: 'Production', dot: 'bg-green-500' },
  staging: { label: 'Staging', dot: 'bg-amber-500' },
  development: { label: 'Development', dot: 'bg-sky-500' },
  custom: { label: 'Custom', dot: 'bg-slate-500' },
};

// Version tag (vN) — low-importance metadata, so it reads as a quiet neutral chip
// rather than a loud accent. Uses semantic surface/text tokens only, so it tracks
// the generated palette and flips with the theme. Rounded (not a pill), before the title.
export const VERSION_TAG_CLASS =
  'text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded-md bg-accented text-toned border border-default';

export interface CardBrand {
  id: 'visa' | 'mastercard' | 'amex' | 'discover';
  label: string;
  /** simple-icons name (self-hosted via @iconify-json/simple-icons). */
  icon: string;
}

const CARD_BRANDS: Array<{ re: RegExp } & CardBrand> = [
  { re: /^4/, id: 'visa', label: 'Visa', icon: 'i-simple-icons-visa' },
  // 51–55 plus the 2221–2720 range introduced in 2017.
  {
    re: /^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/,
    id: 'mastercard',
    label: 'Mastercard',
    icon: 'i-simple-icons-mastercard',
  },
  { re: /^3[47]/, id: 'amex', label: 'Amex', icon: 'i-simple-icons-americanexpress' },
  { re: /^(6011|65|64[4-9])/, id: 'discover', label: 'Discover', icon: 'i-simple-icons-discover' },
];

/** Best-effort card brand from the leading digits (display hint only, no validation). */
export function cardBrand(cardNumber: string | undefined): CardBrand | null {
  const digits = (cardNumber ?? '').replace(/\D/g, '');
  if (digits.length < 2) return null;
  const hit = CARD_BRANDS.find((b) => b.re.test(digits));
  return hit ? { id: hit.id, label: hit.label, icon: hit.icon } : null;
}

/** Mask all but the last `visible` characters of a value. */
export function maskValue(value: string, visible = 4): string {
  if (!value) return '';
  if (value.length <= visible) return '•'.repeat(value.length);
  return '•'.repeat(Math.min(12, value.length - visible)) + value.slice(-visible);
}

/** Secondary line shown under the entry label in the list. */
export function entrySubtitle(entry: DecryptedEntry): string {
  switch (entry.type) {
    case VaultEntryType.LOGIN:
      return entry.username || entry.url || '';
    case VaultEntryType.ENV_FILE: {
      // JSON env files (.NET appsettings) have no meaningful KEY=VALUE rows — parseEnv
      // can extract bogus fragments from lines like `"Db":"Server=x"`.
      if (entry.envContent && detectEnvFormat(entry.envContent) === 'json') return 'JSON file';
      const count = entry.envParsed ? Object.keys(entry.envParsed).length : 0;
      return count ? `${count} ${count === 1 ? 'key' : 'keys'}` : 'ENV file';
    }
    case VaultEntryType.SECRET:
      return entry.secretValue ? maskValue(entry.secretValue) : entry.secretKey || '';
    case VaultEntryType.CREDIT_CARD: {
      if (!entry.cardNumber) return '';
      const digits = entry.cardNumber.replace(/\D/g, '');
      const brand = cardBrand(entry.cardNumber);
      return `${brand ? `${brand.label} ` : ''}•••• ${digits.slice(-4)}`;
    }
    case VaultEntryType.IDENTITY:
      return [entry.firstName, entry.lastName].filter(Boolean).join(' ');
    case VaultEntryType.SECURE_NOTE:
    default:
      return '';
  }
}

/** Text used for client-side search matching (label + type-relevant fields). */
export function searchHaystack(entry: DecryptedEntry): string {
  return [
    entry.label,
    entry.username,
    entry.url,
    entry.secretKey,
    entry.email,
    entry.firstName,
    entry.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
