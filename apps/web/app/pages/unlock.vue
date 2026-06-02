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
  <AuthShell>
    <template #brand>
      <BrandLogo size="md" pulse />
    </template>

    <AuthCard>
      <UForm :state="{ password }" class="space-y-5" @submit.prevent="onSubmit">
        <UFormField
          name="password"
          label="Master Password"
          :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
        >
          <UInput
            v-model="password"
            type="password"
            icon="i-lucide-lock"
            size="lg"
            class="w-full font-mono"
            placeholder="••••••••••••"
            autocomplete="current-password"
            autofocus
            required
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
