<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { useVaultStore } from '~/stores/vault';
import { useNativeRuntime } from '~/composables/useNativeRuntime';
import { useBiometricUnlock } from '~/composables/useBiometricUnlock';
import { usePakQrLogin } from '~/composables/usePakQrLogin';

definePageMeta({ ssr: false });

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const vault = useVaultStore();
const router = useRouter();
const { isNative } = useNativeRuntime();
const biometric = useBiometricUnlock();

const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
// Phase drives the status text so the single spinner is self-explanatory across both
// steps (key derivation, then loading + decrypting the vault) instead of "finishing"
// and then leaving a confusing gap before /vault appears.
const phase = ref<'deriving' | 'loading'>('deriving');
const statusTitle = computed(() =>
  phase.value === 'loading' ? 'Loading your vault…' : 'Deriving encryption key…',
);
const statusHint = computed(() =>
  phase.value === 'loading'
    ? 'Decrypting your entries on this device'
    : 'Computed locally — your password never leaves this device',
);

// Biometric state — only meaningful on native. `biometricAvailable` is set once we
// confirm the user has a key enrolled; it controls both the auto-attempt on mount and
// the explicit retry button.
const biometricAvailable = ref(false);
const biometricLoading = ref(false);
// While biometric is available, the password form stays collapsed behind a manual
// toggle so the auto-attempt genuinely reads as "no further clicks needed" instead of
// showing both the biometric CTA and the full form at once. Any failure path (cancel,
// hardware error, stale-key unenroll, network error) reveals it immediately so the
// fallback is never more than one tap away.
const passwordFormRevealed = ref(false);
const showPasswordForm = computed(() => !biometricAvailable.value || passwordFormRevealed.value);

// PAK QR unlock — desktop-only (phone has the key, desktop shows the QR)
const pak = usePakQrLogin();
const showQr = ref(false);

function openQr() {
  showQr.value = true;
  void pak.start();
}

function closeQr() {
  void pak.cancel();
  showQr.value = false;
}

function retryQr() {
  pak.reset();
  void pak.start();
}

// /unlock is reached after a reload/auto-lock: the session (refresh cookie) is
// still valid but the in-memory CryptoKey is gone. Re-hydrate the session so we
// have the user's kdfSalt to derive from; bounce to login if there's no session,
// or straight to the vault if it's somehow already unlocked.
onMounted(async () => {
  if (cryptoStore.isUnlocked) {
    await router.push('/vault');
    return;
  }
  if (!authStore.user) {
    const ok = await authStore.initialize();
    if (!ok) {
      await router.push('/login');
      return;
    }
  }
  // On native: check enrollment and auto-attempt biometric unlock. The password form
  // is always rendered as the fallback — biometrics only supplement it.
  if (isNative && authStore.user?.id) {
    try {
      const enrolled = await biometric.isEnrolled(authStore.user.id);
      if (enrolled) {
        biometricAvailable.value = true;
        await attemptBiometric();
      }
    } catch {
      // Plugin error — fall back to password form silently.
    }
  }
});

// Attempt biometric unlock. On success unlockWithRawKey sets the vault key in
// the crypto store; we then run the same verify-by-refetch the password path uses.
// If the stored key is stale (device restored, key rotated) the fetchAll decrypt
// fails — we unenroll, clear, and fall back to the password form with an error.
async function attemptBiometric() {
  if (!authStore.user?.id) return;
  biometricLoading.value = true;
  error.value = null;
  // Set only after unlockWithBiometrics resolves true: distinguishes "the key was
  // used and decryption failed" (stale key → unenroll) from "the biometric plugin
  // itself threw" (hardware/OS error → the key was never tested, keep it).
  let biometricOk = false;
  try {
    const ok = await biometric.unlockWithBiometrics(authStore.user.id);
    if (!ok) {
      // User cancelled the prompt — stay on the page, reveal the password fallback.
      passwordFormRevealed.value = true;
      biometricLoading.value = false;
      return;
    }
    biometricOk = true;
    // Key is now set in the crypto store. Verify it actually decrypts the vault.
    await vault.fetchAll();
    await router.push('/vault');
  } catch (err: unknown) {
    // Every failure branch below is a dead end for the biometric path this round —
    // reveal the password fallback immediately rather than leaving it hidden.
    passwordFormRevealed.value = true;
    cryptoStore.lock();
    vault.clear();
    // A fetch/API failure carries a `status` — the key may be fine, the network
    // is not. Keep the enrollment so the user can simply retry.
    if (err !== null && typeof err === 'object' && 'status' in err) {
      error.value = 'Could not reach the server. Check your connection and retry.';
    } else if (biometricOk) {
      // Stale key: the biometric succeeded but decryption failed. Unenroll so the
      // user is not stuck behind a permanently broken biometric prompt, then show
      // the password form with a clear explanation.
      await biometric.unenroll(authStore.user.id);
      biometricAvailable.value = false;
      error.value =
        'Biometric key is out of date. Please unlock with your master password to re-enroll.';
    } else {
      // The plugin threw before the key was ever used — do not unenroll.
      error.value =
        'Biometric authentication failed. Please try again or use your master password.';
    }
    biometricLoading.value = false;
  }
}

async function onSubmit() {
  if (!password.value) return;
  if (!authStore.user?.kdfSalt) {
    error.value = 'Your session has expired. Please sign in again.';
    return;
  }
  loading.value = true;
  error.value = null;
  phase.value = 'deriving';
  try {
    await cryptoStore.deriveKey(password.value, authStore.user.kdfSalt);
    password.value = '';
    // Load + decrypt the whole vault HERE, before navigating, so:
    //  (1) the single spinner stays continuous until the data is ready and /vault
    //      renders fully populated (no "spinner stops, then blank for seconds"),
    //  (2) a wrong master password is caught now — AES-GCM decryption fails on the
    //      bad key — instead of erroring after the redirect.
    phase.value = 'loading';
    await vault.fetchAll();
    await router.push('/vault');
    // Success: keep `loading` true. router.push resolves before the DOM swaps to
    // /vault, so clearing it here would briefly re-render the unlock form without its
    // spinner (the "reset" flash) before the redirect paints. The page unmounts on
    // navigation anyway.
  } catch {
    // Wrong password (decrypt failed) or load error: drop the bad key and re-enable
    // the form so the user can retry.
    cryptoStore.lock();
    vault.clear();
    error.value = 'Failed to unlock vault. Check your master password.';
    loading.value = false;
  }
}
</script>

<template>
  <AuthShell>
    <template #brand>
      <BrandLogo size="md" pulse />
      <p v-if="authStore.user?.email" class="mt-2 text-center text-sm text-muted">
        Unlocking <span class="font-medium text-default">{{ authStore.user.email }}</span>
      </p>
    </template>

    <AuthCard>
      <!-- Desktop header: the brand block (logo + email) above the card is mobile-only
           in the split-panel shell, so the card restates the context on lg+. -->
      <div class="hidden lg:block">
        <h2 class="text-lg font-semibold">Vault locked</h2>
        <p class="mb-5 mt-1 text-sm text-muted">
          <template v-if="authStore.user?.email">
            Unlocking <span class="font-medium text-default">{{ authStore.user.email }}</span>
          </template>
          <template v-else>Enter your master password to continue.</template>
        </p>
      </div>

      <!-- Biometric retry button: shown on native when a key is enrolled, so the
           user can re-trigger the prompt after cancelling or after auto-attempt. -->
      <div v-if="biometricAvailable" class="mb-5">
        <UButton
          block
          size="lg"
          color="primary"
          variant="subtle"
          icon="i-lucide-fingerprint"
          aria-label="Unlock with biometrics"
          :loading="biometricLoading"
          :disabled="biometricLoading"
          @click="attemptBiometric"
        >
          Unlock with biometrics
        </UButton>
        <div v-if="showPasswordForm" class="relative my-5 flex items-center">
          <div class="flex-1 border-t border-default" />
          <span class="mx-3 text-[11px] text-muted">or use master password</span>
          <div class="flex-1 border-t border-default" />
        </div>
        <button
          v-else
          type="button"
          class="mt-4 block w-full text-center text-xs text-muted hover:text-default hover:underline"
          @click="passwordFormRevealed = true"
        >
          Use master password instead
        </button>
      </div>

      <!-- PAK QR unlock: desktop-only — phone holds the encrypted vault key -->
      <template v-if="!isNative">
        <div v-if="!showQr" class="mb-5">
          <UButton
            block
            size="lg"
            color="primary"
            variant="subtle"
            icon="i-lucide-smartphone"
            aria-label="Unlock with Phone"
            @click="openQr"
          >
            <span class="hidden sm:inline">Unlock with Phone</span>
            <span class="sm:hidden" aria-hidden="true">Phone Key</span>
          </UButton>
          <div class="relative my-5 flex items-center">
            <div class="flex-1 border-t border-default" />
            <span class="mx-3 text-[11px] text-muted">or use master password</span>
            <div class="flex-1 border-t border-default" />
          </div>
        </div>

        <div v-if="showQr" class="mb-5">
          <PakQrPanel
            :qr-url="pak.qrUrl.value"
            :phase="pak.phase.value"
            :error="pak.error.value"
            @cancel="closeQr"
            @retry="retryQr"
          />
        </div>

        <!-- Recovery fallback link — shown below the PAK block when phone is unavailable -->
        <div class="mb-5 text-center text-sm">
          <NuxtLink
            to="/pak/recover"
            class="text-muted hover:text-default underline-offset-2 hover:underline"
          >
            Lost your phone? Use recovery kit
          </NuxtLink>
        </div>
      </template>

      <UForm v-show="!showQr && showPasswordForm" :state="{ password }" class="space-y-5" @submit.prevent="onSubmit">
        <UFormField
          name="password"
          label="Master Password"
          :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
        >
          <PasswordInput
            v-model="password"
            placeholder="••••••••••••"
            autocomplete="off"
            autofocus
          />
        </UFormField>

        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <UButton
          type="submit"
          block
          size="lg"
          class="accent-glow"
          :loading="loading"
          :disabled="!password"
        >
          {{ loading ? 'Unlocking…' : 'Unlock Vault' }}
        </UButton>

        <KeyDerivationStatus v-if="loading" :title="statusTitle" :hint="statusHint" />
      </UForm>

      <p class="mt-5 text-center text-xs text-muted">
        Not you?
        <button
          type="button"
          class="ml-1 font-medium text-primary hover:underline"
          @click="authStore.logout().then(() => router.push('/login'))"
        >
          Sign out
        </button>
      </p>
    </AuthCard>

    <p class="mx-auto mt-4 max-w-xs text-center text-xs text-muted">
      If you forget your master password, your vault cannot be recovered.
      There is no reset link — encryption keys are derived only from your password.
    </p>

    <template #footer>
      <UIcon name="i-lucide-shield-check" class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>Zero-knowledge · Your data stays encrypted, even from us</span>
    </template>
  </AuthShell>
</template>
