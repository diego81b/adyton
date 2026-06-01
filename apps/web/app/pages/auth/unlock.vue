<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';

definePageMeta({ ssr: false });

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const router = useRouter();

const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

async function onSubmit() {
  if (!password.value || !authStore.user?.kdfSalt) return;
  loading.value = true;
  error.value = null;
  try {
    await cryptoStore.deriveKey(password.value, authStore.user.kdfSalt);
    password.value = '';
    await router.push('/vault');
  } catch {
    password.value = '';
    error.value = 'Failed to unlock vault. Check your master password.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-neutral-950 p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-2">
          <span class="text-2xl">🔒</span>
          <h1 class="text-lg font-semibold">Vault locked</h1>
        </div>
      </template>

      <UForm @submit.prevent="onSubmit" class="space-y-4">
        <p class="text-sm text-neutral-400">
          Enter your master password to unlock the vault.
          <strong class="text-neutral-200">Your password never leaves this device.</strong>
        </p>

        <UFormField label="Master password" name="password">
          <UInput
            v-model="password"
            type="password"
            placeholder="············"
            autocomplete="current-password"
            autofocus
            required
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :description="error"
        />

        <UButton
          type="submit"
          block
          :loading="loading"
          :disabled="!password"
        >
          {{ loading ? 'Unlocking…' : 'Unlock vault' }}
        </UButton>
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-neutral-400">
          Not you?
          <button
            class="text-primary-400 hover:underline"
            @click="authStore.logout().then(() => router.push('/auth/login'))"
          >
            Sign out
          </button>
        </p>
      </template>
    </UCard>
  </div>
</template>
