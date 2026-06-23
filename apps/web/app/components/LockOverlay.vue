<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useCryptoStore } from '../stores/crypto';
import { useVaultStore } from '../stores/vault';
import { useNativeRuntime } from '../composables/useNativeRuntime';
import { useBiometricUnlock } from '../composables/useBiometricUnlock';

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const vaultStore = useVaultStore();
const { isNative } = useNativeRuntime();
const biometric = useBiometricUnlock();

const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

const open = computed(() => !cryptoStore.isUnlocked);

const biometricAvailable = ref(false);
const biometricLoading = ref(false);

// When the overlay opens, check enrollment and show the biometric button if available.
// No auto-attempt here — the user chose to lock explicitly, so we let them decide
// whether to use biometrics or the password form.
watch(open, async (isOpen) => {
  if (!isOpen || !isNative || !authStore.user?.id) return;
  biometricAvailable.value = false;
  try {
    const enrolled = await biometric.isEnrolled(authStore.user.id);
    biometricAvailable.value = enrolled;
  } catch {
    // Plugin error — fall back to password form silently.
  }
});

async function attemptBiometric() {
  if (!authStore.user?.id) return;
  biometricLoading.value = true;
  error.value = null;
  let biometricOk = false;
  try {
    const ok = await biometric.unlockWithBiometrics(authStore.user.id);
    if (!ok) {
      biometricLoading.value = false;
      return;
    }
    biometricOk = true;
    // Verify the key actually decrypts the vault (same as password path).
    await vaultStore.fetchEntries(true);
    // overlay closes automatically when cryptoStore.isUnlocked becomes true
  } catch (err: unknown) {
    cryptoStore.lock();
    if (err !== null && typeof err === 'object' && 'status' in err) {
      error.value = 'Could not reach the server. Check your connection and retry.';
    } else if (biometricOk) {
      // Stale key: biometric succeeded but vault decrypt failed.
      await biometric.unenroll(authStore.user.id);
      biometricAvailable.value = false;
      error.value = 'Biometric key is out of date. Please unlock with your master password to re-enroll.';
    } else {
      error.value = 'Biometric authentication failed. Please try again or use your master password.';
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
  try {
    await cryptoStore.deriveKey(password.value, authStore.user.kdfSalt);
    await vaultStore.fetchEntries(true);
    password.value = '';
  } catch {
    cryptoStore.lock();
    password.value = '';
    error.value = 'Wrong master password. Try again.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UModal
    :open="open"
    :dismissible="false"
    :close="false"
    :ui="{ content: 'max-w-sm' }"
    title="Vault locked"
    description="Enter your master password to unlock."
  >
    <template #content>
      <div class="p-6">
        <div class="text-center mb-6">
          <div class="inline-flex">
            <BrandLogo size="md" pulse />
          </div>
          <p v-if="authStore.user?.email" class="mt-2 text-sm text-muted">
            Locked · <span class="font-medium text-default">{{ authStore.user.email }}</span>
          </p>
        </div>

        <!-- Biometric button: native only, shown when a key is enrolled. -->
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
          <div class="relative my-5 flex items-center">
            <div class="flex-1 border-t border-default" />
            <span class="mx-3 text-[11px] text-muted">or use master password</span>
            <div class="flex-1 border-t border-default" />
          </div>
        </div>

        <UForm :state="{ password }" class="space-y-5" @submit.prevent="onSubmit">
          <UFormField
            name="password"
            label="Master Password"
            :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
          >
            <PasswordInput
              v-model="password"
              placeholder="••••••••••••"
              autocomplete="current-password"
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

          <KeyDerivationStatus v-if="loading" />
        </UForm>
      </div>
    </template>
  </UModal>
</template>
