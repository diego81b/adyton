import { ref, reactive, computed, watch } from 'vue';
import {
  generatePassword,
  generatePassphraseWords,
  passwordEntropyBits,
  passphraseEntropyBits,
  PASSPHRASE_DEFAULTS,
  type PasswordOptions,
} from '@adyton/shared';

export type GeneratorMode = 'password' | 'passphrase';

export interface StrengthTier {
  label: string;
  badgeClass: string;
  description: string;
}

// Thresholds in bits of real entropy (computed from the actual charset pool /
// wordlist size in shared — never approximated client-side).
const TIERS: Array<{ min: number } & StrengthTier> = [
  {
    min: 100,
    label: 'Excellent',
    badgeClass: 'text-primary bg-primary/10 border-primary/30',
    description: 'Effectively uncrackable with current hardware',
  },
  {
    min: 65,
    label: 'Strong',
    badgeClass: 'text-green-400 bg-green-500/10 border-green-500/30',
    description: 'Would take centuries to crack with current hardware',
  },
  {
    min: 45,
    label: 'Fair',
    badgeClass: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    description: 'Acceptable for low-value accounts — consider more length',
  },
  {
    min: 0,
    label: 'Weak',
    badgeClass: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    description: 'Too guessable — add length or character classes',
  },
];

export function useGenerator() {
  const mode = ref<GeneratorMode>('password');
  const passwordOptions = reactive<PasswordOptions>({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false,
  });
  const wordCount = ref(5);

  const generated = ref('');
  const words = ref<string[]>([]);
  const error = ref('');

  function regenerate() {
    error.value = '';
    try {
      if (mode.value === 'password') {
        words.value = [];
        generated.value = generatePassword(passwordOptions);
      } else {
        words.value = generatePassphraseWords(wordCount.value);
        generated.value = words.value.join(PASSPHRASE_DEFAULTS.separator);
      }
    } catch (err) {
      generated.value = '';
      words.value = [];
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  // Options changes regenerate immediately (mockup behavior) — also produces the
  // initial value on mount via `immediate`.
  watch([mode, passwordOptions, wordCount], regenerate, { immediate: true });

  const entropyBits = computed(() =>
    mode.value === 'password'
      ? passwordEntropyBits(passwordOptions)
      : passphraseEntropyBits(wordCount.value),
  );

  const strength = computed<StrengthTier>(() => {
    const bits = entropyBits.value;
    const tier = TIERS.find((t) => bits >= t.min) ?? TIERS[TIERS.length - 1]!;
    const { label, badgeClass, description } = tier;
    return { label, badgeClass, description };
  });

  return { mode, passwordOptions, wordCount, generated, words, error, entropyBits, strength, regenerate };
}
