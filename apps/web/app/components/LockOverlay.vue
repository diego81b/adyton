<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useCryptoStore } from '../stores/crypto';
import { useVaultStore } from '../stores/vault';

// Full-screen lock overlay shown when the vault locks while the user stays on a
// protected page (auto-lock timer fired, or the lock pill was clicked). Re-derives
// the key in place — no navigation, no network round-trip for the key itself.
// Verification: after deriving, re-fetch entries; a wrong master password yields a
// key that fails AES-GCM decryption, so we re-lock and show an error.

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const vaultStore = useVaultStore();

const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

const open = computed(() => !cryptoStore.isUnlocked);

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
    // Verify the derived key actually decrypts the vault.
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
            class="accent-glow text-white"
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
