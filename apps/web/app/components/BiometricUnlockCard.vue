<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { useNativeRuntime } from '~/composables/useNativeRuntime';
import { useBiometricUnlock } from '~/composables/useBiometricUnlock';
import { deriveRawKey } from '~/composables/useArgon2Worker';
import PasswordPromptModal from './PasswordPromptModal.vue';

// Biometric unlock management — visible only on native (iOS / Android).
// The parent settings page does not need to gate this card: it self-gates via
// isNative. Enroll requires the master password to derive + verify the raw key
// before handing it to the biometric store; disable needs no confirmation (we
// are merely removing stored key material from secure storage, not a destructive
// account action).
const auth = useAuthStore();
const crypto = useCryptoStore();
const toast = useToast();
const { isNative } = useNativeRuntime();
const biometric = useBiometricUnlock();

// Resolved on mount; undefined while loading to avoid a flicker.
const supported = ref<boolean | undefined>(undefined);
const enrolled = ref(false);

onMounted(async () => {
  if (!isNative) return;
  const [sup, enr] = await Promise.all([
    biometric.isSupported(),
    biometric.isEnrolled(auth.user?.id ?? ''),
  ]);
  supported.value = sup;
  enrolled.value = enr;
});

// --- Enable flow (password prompt → derive → verify → enroll) ----------------
const promptOpen = ref(false);
const promptLoading = ref(false);
const promptError = ref<string | null>(null);

function openEnable() {
  promptError.value = null;
  promptOpen.value = true;
}

async function confirmEnable(password: string) {
  if (!auth.user?.kdfSalt || !auth.user?.id) return;
  // The cross-check needs the live vault key; if an auto-lock fired meanwhile,
  // the LockOverlay is about to take over — bail instead of crashing.
  if (!crypto.cryptoKey) {
    promptError.value = 'Vault is locked. Unlock it first.';
    return;
  }
  promptLoading.value = true;
  promptError.value = null;
  try {
    const raw = await deriveRawKey(password, auth.user.kdfSalt);
    try {
      const matches = await biometric.verifyRawKeyMatches(raw, crypto.cryptoKey);
      if (!matches) {
        promptError.value = 'Wrong master password.';
        return;
      }
      await biometric.enroll(auth.user.id, raw);
    } finally {
      // Best-effort zeroize: the raw key bytes must not outlive the enrollment
      // window on the JS heap.
      new Uint8Array(raw).fill(0);
    }
    enrolled.value = true;
    promptOpen.value = false;
    toast.add({ title: 'Biometric unlock enabled', color: 'success' });
  } catch {
    promptError.value = 'Something went wrong. Please try again.';
  } finally {
    promptLoading.value = false;
  }
}

// --- Disable flow (no password needed — just remove stored key material) -----
const disabling = ref(false);

async function disable() {
  if (!auth.user?.id) return;
  disabling.value = true;
  try {
    await biometric.unenroll(auth.user.id);
    enrolled.value = false;
    toast.add({ title: 'Biometric unlock disabled', color: 'success' });
  } catch {
    toast.add({ title: 'Could not disable biometric unlock', color: 'error' });
  } finally {
    disabling.value = false;
  }
}
</script>

<template>
  <!-- Self-gate: render nothing on web — this feature is native-only. -->
  <template v-if="isNative">
    <div class="rounded-2xl border border-default bg-elevated p-4">
      <div class="mb-0.5 flex items-center gap-2">
        <h3 class="text-base font-semibold">Biometric unlock</h3>
        <span
          v-if="enrolled"
          class="flex items-center gap-1 rounded-full border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-brand-300"
        >
          <span class="size-1.5 rounded-full bg-brand-400" />
          Enabled
        </span>
        <span
          v-else-if="supported !== undefined && supported"
          class="rounded-full border border-default bg-accented px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-muted"
        >
          Not configured
        </span>
      </div>

      <!-- Device has no biometrics enrolled -->
      <p
        v-if="supported === false"
        class="mt-1 text-[13px] text-muted"
      >
        No biometrics are enrolled on this device. Set up Face ID, Touch ID, or a fingerprint
        in your device settings first.
      </p>

      <template v-else-if="supported !== undefined">
        <p class="text-[13px] text-muted">
          Unlock your vault with Face ID, Touch ID, or fingerprint instead of typing your
          master password.
        </p>

        <div class="mt-4">
          <!-- Enabled: show disable button -->
          <UButton
            v-if="enrolled"
            color="error"
            variant="subtle"
            size="md"
            icon="i-lucide-fingerprint"
            aria-label="Disable biometric unlock"
            :loading="disabling"
            @click="disable"
          >
            Disable
          </UButton>

          <!-- Not enrolled: show enable button -->
          <UButton
            v-else
            color="primary"
            variant="subtle"
            size="md"
            icon="i-lucide-fingerprint"
            aria-label="Enable biometric unlock"
            @click="openEnable"
          >
            Enable biometric unlock
          </UButton>
        </div>
      </template>

      <!-- Loading state while probing support/enrollment -->
      <p v-else class="mt-2 text-[13px] text-muted">Checking biometric availability…</p>

      <PasswordPromptModal
        v-model:open="promptOpen"
        title="Enable biometric unlock"
        confirm-label="Enable"
        :loading="promptLoading"
        :error="promptError"
        @confirm="confirmEnable"
      />
    </div>
  </template>
</template>
