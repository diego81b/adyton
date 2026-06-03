<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { useVaultStore } from '~/stores/vault';

definePageMeta({ ssr: false });

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const vault = useVaultStore();
const router = useRouter();

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
      <UForm :state="{ password }" class="space-y-5" @submit.prevent="onSubmit">
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
          class="accent-glow text-white"
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

    <template #footer>
      🛡️ Zero-knowledge · Your data stays encrypted, even from us
    </template>
  </AuthShell>
</template>
