import { VaultEntryType, type DecryptedEntry, type EnvironmentTag } from '@adyton/shared';

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

// Static, purge-safe class strings per semantic color (dynamic `bg-${color}` would be
// stripped by Tailwind — same trap that bit the step-0 strength meter). Used for the
// colored icon tile on each card, mirroring the mockup's per-type tinting.
export const TILE_CLASS: Record<TypeMeta['color'], string> = {
  primary: 'bg-primary/10 border-primary/20 text-primary',
  info: 'bg-info/10 border-info/20 text-info',
  success: 'bg-success/10 border-success/20 text-success',
  warning: 'bg-warning/10 border-warning/20 text-warning',
  error: 'bg-error/10 border-error/20 text-error',
  neutral: 'bg-elevated border-default text-muted',
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

// Per-chip ACTIVE color (mockup screen-vault chip palette). Static strings — a dynamic
// `bg-${c}-900/40` would be purged. Inactive chips share one muted style (see page).
export type ChipKey = VaultEntryType | 'all';
export const CHIP_ACTIVE_CLASS: Record<ChipKey, string> = {
  all: 'bg-emerald-900/40 text-emerald-300',
  [VaultEntryType.LOGIN]: 'bg-blue-900/40 text-blue-300',
  [VaultEntryType.ENV_FILE]: 'bg-orange-900/40 text-orange-300',
  [VaultEntryType.SECRET]: 'bg-red-900/40 text-red-300',
  [VaultEntryType.SECURE_NOTE]: 'bg-yellow-900/40 text-yellow-300',
  [VaultEntryType.CREDIT_CARD]: 'bg-purple-900/40 text-purple-300',
  [VaultEntryType.IDENTITY]: 'bg-teal-900/40 text-teal-300',
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
      const count = entry.envParsed ? Object.keys(entry.envParsed).length : 0;
      return count ? `${count} ${count === 1 ? 'key' : 'keys'}` : 'ENV file';
    }
    case VaultEntryType.SECRET:
      return entry.secretValue ? maskValue(entry.secretValue) : entry.secretKey || '';
    case VaultEntryType.CREDIT_CARD:
      return entry.cardNumber ? `•••• ${entry.cardNumber.slice(-4)}` : '';
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
