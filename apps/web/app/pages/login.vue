<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';

definePageMeta({ ssr: false });

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const router = useRouter();

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

async function onSubmit() {
  if (!email.value || !password.value) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await authStore.login(email.value, password.value);
    // One-capture flow: derive vault key immediately after auth succeeds.
    // kdfSalt is in the auth response — same password, different salt, different derivation.
    await cryptoStore.deriveKey(password.value, result.user.kdfSalt);
    password.value = ''; // clear from memory
    await router.push('/vault');
  } catch (err: unknown) {
    password.value = '';
    if (err && typeof err === 'object' && 'data' in err) {
      const e = err as { data: { message?: string } };
      error.value = e.data?.message ?? 'Login failed.';
    } else {
      error.value = 'Login failed. Check credentials and try again.';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthShell>
    <template #brand>
      <BrandLogo tagline="Zero-knowledge vault for what matters" />
    </template>

    <AuthCard>
      <h2 class="mb-5 text-lg font-semibold">Welcome back</h2>

      <UForm :state="{ email, password }" class="space-y-5" @submit.prevent="onSubmit">
        <UFormField
          name="email"
          label="Email"
          :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
        >
          <UInput
            v-model="email"
            type="email"
            icon="i-lucide-mail"
            size="lg"
            class="w-full"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </UFormField>

        <UFormField
          name="password"
          label="Master Password"
          :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
        >
          <PasswordInput
            v-model="password"
            placeholder="••••••••••••"
            autocomplete="current-password"
          />
        </UFormField>

        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <UButton
          type="submit"
          block
          size="lg"
          trailing-icon="i-lucide-arrow-right"
          class="accent-glow text-white"
          :loading="loading"
          :disabled="!email || !password"
        >
          {{ loading ? 'Unlocking vault…' : 'Sign in' }}
        </UButton>
      </UForm>

      <p class="mt-5 text-center text-xs text-muted">
        New here?
        <NuxtLink to="/register" class="ml-1 font-medium text-primary hover:underline">
          Create an account →
        </NuxtLink>
      </p>
    </AuthCard>

    <template #footer>
      🔐 Encrypted client-side · Argon2id + AES-256-GCM
    </template>
  </AuthShell>
</template>
