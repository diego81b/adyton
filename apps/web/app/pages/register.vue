<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { usePasswordStrength } from '~/composables/usePasswordStrength';

definePageMeta({ ssr: false });

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const router = useRouter();

const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

const { validating, score, valid, segColor, label, labelColor, bits } =
  usePasswordStrength(password);

const passwordsMatch = computed(
  () => !confirmPassword.value || password.value === confirmPassword.value,
);

const canSubmit = computed(
  () =>
    !loading.value &&
    !!email.value &&
    !!password.value &&
    password.value === confirmPassword.value &&
    valid.value,
);

async function onSubmit() {
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await authStore.register(email.value, password.value);
    await cryptoStore.deriveKey(password.value, result.user.kdfSalt);
    password.value = '';
    confirmPassword.value = '';
    await router.push('/vault');
  } catch (err: unknown) {
    password.value = '';
    confirmPassword.value = '';
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
  <AuthShell>
    <template #brand>
      <BrandLogo size="md" tagline="Your master password never leaves this device" />
    </template>

    <AuthCard>
      <UForm
        :state="{ email, password, confirmPassword }"
        class="space-y-5"
        @submit.prevent="onSubmit"
      >
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
          <UInput
            v-model="password"
            type="password"
            icon="i-lucide-lock"
            size="lg"
            class="w-full font-mono"
            placeholder="Choose something memorable but strong"
            autocomplete="new-password"
            required
          />
          <PasswordStrengthMeter
            v-if="password"
            class="mt-2"
            :score="score"
            :label="label"
            :label-color="labelColor"
            :bits="bits"
            :seg-color="segColor"
            :validating="validating"
          />
        </UFormField>

        <UFormField
          name="confirmPassword"
          label="Confirm Password"
          :error="!passwordsMatch && 'Passwords do not match.'"
          :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
        >
          <UInput
            v-model="confirmPassword"
            type="password"
            icon="i-lucide-lock"
            size="lg"
            class="w-full font-mono"
            placeholder="Type it again"
            autocomplete="new-password"
            required
          />
        </UFormField>

        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <UAlert color="primary" variant="soft" icon="i-lucide-info">
          <template #description>
            <strong class="font-semibold">Your master password never leaves this device.</strong>
            If you forget it, your vault is unrecoverable. There is no reset.
          </template>
        </UAlert>

        <UButton
          type="submit"
          block
          size="lg"
          class="accent-glow"
          :loading="loading"
          :disabled="!canSubmit"
        >
          {{ loading ? 'Creating vault…' : 'Create Account' }}
        </UButton>
      </UForm>

      <p class="mt-5 text-center text-xs text-muted">
        Already have an account?
        <NuxtLink to="/login" class="ml-1 font-medium text-primary hover:underline">
          Sign in
        </NuxtLink>
      </p>
    </AuthCard>
  </AuthShell>
</template>
