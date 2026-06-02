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
    if (!ok) await router.push('/login');
  }
});

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
  <AuthShell>
    <template #brand>
      <BrandLogo size="md" pulse />
      <p v-if="authStore.user?.email" class="mt-2 text-center text-sm text-muted">
        Unlocking <span class="font-medium text-default">{{ authStore.user.email }}</span>
      </p>
    </template>

    <AuthCard>
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

    <template #footer>
      🛡️ Zero-knowledge · Your data stays encrypted, even from us
    </template>
  </AuthShell>
</template>
