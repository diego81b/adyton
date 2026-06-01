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
  <div class="flex min-h-screen items-center justify-center bg-neutral-950 p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-lg font-semibold">Sign in to Adyton</h1>
      </template>

      <UForm @submit.prevent="onSubmit" class="space-y-4">
        <UFormField label="Email" name="email">
          <UInput
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </UFormField>

        <UFormField label="Master password" name="password">
          <UInput
            v-model="password"
            type="password"
            placeholder="············"
            autocomplete="current-password"
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
          :disabled="!email || !password"
        >
          {{ loading ? 'Unlocking vault…' : 'Sign in' }}
        </UButton>
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-neutral-400">
          No account?
          <NuxtLink to="/register" class="text-primary-400 hover:underline">
            Create one
          </NuxtLink>
        </p>
      </template>
    </UCard>
  </div>
</template>
