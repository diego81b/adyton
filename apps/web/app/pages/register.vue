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

const { validating, score, valid, feedback, segColor, label, labelColor, bits } =
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
          <PasswordInput
            v-model="password"
            placeholder="Choose something memorable but strong"
            autocomplete="new-password"
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

          <!-- Strength is enforced client-side only (backend checks length 12+),
               so the rejection reasons must be surfaced here. -->
          <div v-if="password && !validating" class="mt-2 space-y-1">
            <p
              v-for="(msg, i) in feedback"
              :key="i"
              class="flex items-start gap-1.5 text-xs text-error"
            >
              <UIcon name="i-lucide-x" class="mt-0.5 size-3.5 shrink-0" />
              <span>{{ msg }}</span>
            </p>
            <p v-if="valid" class="flex items-center gap-1.5 text-xs text-success">
              <UIcon name="i-lucide-check" class="size-3.5 shrink-0" />
              <span>Password meets all requirements.</span>
            </p>
          </div>
        </UFormField>

        <UFormField
          name="confirmPassword"
          label="Confirm Password"
          :error="!passwordsMatch && 'Passwords do not match.'"
          :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
        >
          <PasswordInput
            v-model="confirmPassword"
            placeholder="Type it again"
            autocomplete="new-password"
          />
        </UFormField>

        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <!-- TODO(phase-10): when the zero-knowledge Recovery Kit lands
             (analysis/roadmap/device-as-key.md §16.9 — BIP39 phrase wraps the vault
             key, server never sees it), soften this copy to e.g. "unrecoverable
             without your recovery kit". Until then "no reset" is correct by design:
             a server-side reset would break zero-knowledge (invariant #1). -->
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
          class="accent-glow text-white"
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
