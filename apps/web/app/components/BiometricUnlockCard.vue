<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { useNativeRuntime } from '~/composables/useNativeRuntime';
import { useBiometricUnlock } from '~/composables/useBiometricUnlock';
import { deriveRawKey } from '~/composables/useArgon2Worker';
import PasswordPromptModal from './PasswordPromptModal.vue';
import SettingRow from './SettingRow.vue';

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
    <SettingRow
      label="Biometric unlock"
      :helper="
        supported === false
          ? 'Set up Face ID, Touch ID, or a fingerprint on this device first'
          : supported === undefined
            ? 'Checking availability…'
            : 'Unlock with Face ID, Touch ID, or fingerprint instead of your master password'
      "
      :dot="enrolled ? 'bg-success' : supported ? 'bg-surface-400' : undefined"
    >
      <template v-if="supported" #action>
        <UButton
          v-if="enrolled"
          color="error"
          variant="ghost"
          size="sm"
          icon="i-lucide-fingerprint"
          aria-label="Disable biometric unlock"
          :loading="disabling"
          @click="disable"
        >
          <span class="hidden sm:inline">Disable</span>
        </UButton>
        <UButton
          v-else
          color="primary"
          variant="subtle"
          size="sm"
          icon="i-lucide-fingerprint"
          aria-label="Enable biometric unlock"
          @click="openEnable"
        >
          <span class="hidden sm:inline">Enable</span>
        </UButton>
      </template>
    </SettingRow>

    <PasswordPromptModal
      v-model:open="promptOpen"
      title="Enable biometric unlock"
      confirm-label="Enable"
      :loading="promptLoading"
      :error="promptError"
      @confirm="confirmEnable"
    />
  </template>
</template>
