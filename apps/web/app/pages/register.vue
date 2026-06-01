<script setup lang="ts">
import { validateMasterPassword } from '@adyton/shared';
import type { PasswordStrengthResult } from '@adyton/shared';
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
const strength = ref<PasswordStrengthResult | null>(null);
const validating = ref(false);
let validationTimer: ReturnType<typeof setTimeout> | null = null;

// Debounced strength validation (runs at most once per 500ms after typing stops)
watch(password, (pw) => {
  strength.value = null;
  if (validationTimer) clearTimeout(validationTimer);
  if (!pw) return;
  validationTimer = setTimeout(async () => {
    validating.value = true;
    try {
      strength.value = await validateMasterPassword(pw);
    } finally {
      validating.value = false;
    }
  }, 500);
});

const canSubmit = computed(() =>
  !loading.value &&
  !!email.value &&
  !!password.value &&
  strength.value?.valid === true,
);

const strengthColor = computed(() => {
  if (!strength.value) return 'neutral';
  const map = ['error', 'error', 'warning', 'warning', 'success'] as const;
  return map[strength.value.score] ?? 'neutral';
});

async function onSubmit() {
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await authStore.register(email.value, password.value);
    await cryptoStore.deriveKey(password.value, result.user.kdfSalt);
    password.value = '';
    await router.push('/vault');
  } catch (err: unknown) {
    password.value = '';
    if (err && typeof err === 'object' && 'data' in err) {
      const e = err as { data: { message?: string } };
      error.value = e.data?.message ?? 'Registration failed.';
    } else {
      error.value = 'Registration failed. Try again.';
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
        <h1 class="text-lg font-semibold">Create your vault</h1>
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
            autocomplete="new-password"
            required
          />
        </UFormField>

        <!-- Strength meter -->
        <div v-if="password" class="space-y-1">
          <div class="flex gap-1">
            <div
              v-for="i in 4"
              :key="i"
              class="h-1 flex-1 rounded-full transition-colors"
              :class="strength && strength.score >= i ? `bg-${strengthColor}-400` : 'bg-neutral-700'"
            />
          </div>
          <div v-if="validating" class="text-xs text-neutral-500">Checking…</div>
          <div v-else-if="strength" class="space-y-1">
            <p
              v-for="(msg, i) in strength.feedback"
              :key="i"
              class="text-xs text-error-400"
            >
              {{ msg }}
            </p>
            <p v-if="strength.valid" class="text-xs text-success-400">
              Password meets all requirements.
            </p>
          </div>
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :description="error"
        />

        <UAlert
          color="info"
          variant="soft"
          description="Your master password never leaves this device. It encrypts your vault locally. If you forget it, your vault cannot be recovered."
        />

        <UButton
          type="submit"
          block
          :loading="loading"
          :disabled="!canSubmit"
        >
          {{ loading ? 'Creating vault…' : 'Create vault' }}
        </UButton>
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-neutral-400">
          Already have an account?
          <NuxtLink to="/login" class="text-primary-400 hover:underline">
            Sign in
          </NuxtLink>
        </p>
      </template>
    </UCard>
  </div>
</template>
