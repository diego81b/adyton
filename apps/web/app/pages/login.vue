<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { useWebAuthn } from '~/composables/useWebAuthn';

definePageMeta({ ssr: false });

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const { authenticateWithPasskey } = useWebAuthn();
const router = useRouter();

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

// Login is a two-stage flow for 2FA accounts: credentials → mfa challenge.
const phase = ref<'credentials' | 'mfa'>('credentials');
const mfaToken = ref<string | null>(null);
const mfaMethods = ref<Array<'totp' | 'webauthn'>>(['totp']);

function toErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const e = err as { data?: { message?: string } };
    return e.data?.message ?? fallback;
  }
  return fallback;
}

// Derive the vault key from the (still in-memory) password, clear it, and enter the vault.
async function completeLogin(kdfSalt: string) {
  await cryptoStore.deriveKey(password.value, kdfSalt);
  password.value = '';
  await router.push('/vault');
}

async function onSubmit() {
  if (!email.value || !password.value) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await authStore.login(email.value, password.value);
    if ('requiresMfa' in result) {
      // Keep the password in its ref — still needed to derive the vault key AFTER the
      // second factor succeeds (memory-only, same exposure as while the user typed it).
      mfaToken.value = result.mfaToken;
      mfaMethods.value = result.methods ?? ['totp'];
      phase.value = 'mfa';
      return;
    }
    await completeLogin(result.user.kdfSalt);
  } catch (err: unknown) {
    password.value = '';
    error.value = toErrorMessage(err, 'Login failed. Check credentials and try again.');
  } finally {
    loading.value = false;
  }
}

function resetToCredentials() {
  phase.value = 'credentials';
  mfaToken.value = null;
  mfaMethods.value = ['totp'];
  password.value = '';
}

async function onMfaSubmit(payload: { code?: string; recoveryCode?: string }) {
  if (!mfaToken.value) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await authStore.authenticateTwoFactor({ mfaToken: mfaToken.value, ...payload });
    await completeLogin(result.user.kdfSalt);
  } catch (err: unknown) {
    const message = toErrorMessage(err, 'Verification failed. Try again.');
    // An expired token or exhausted attempts can't be recovered from the challenge —
    // send the user back to re-enter credentials (which mints a fresh mfaToken).
    if (/expired|too many attempts/i.test(message)) {
      resetToCredentials();
      error.value = message;
    } else {
      error.value = message;
    }
  } finally {
    loading.value = false;
  }
}

// WebAuthn login path. Both the ceremony (cancel/unsupported) and the server (invalid
// passkey / expired token) surface as Error.message — toErrorMessage would miss the
// ceremony ones (no `.data`), so read the message directly. Expired token / too many
// attempts can't be retried from the challenge → reset to credentials (mint a fresh
// mfaToken); everything else (cancel, unsupported, invalid passkey) stays in-phase.
async function onMfaPasskey() {
  if (!mfaToken.value) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await authenticateWithPasskey(mfaToken.value);
    await completeLogin(result.user.kdfSalt);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Passkey sign-in failed. Try again.';
    if (/expired|too many attempts/i.test(message)) {
      resetToCredentials();
    }
    error.value = message;
  } finally {
    loading.value = false;
  }
}

function onMfaBack() {
  error.value = null;
  resetToCredentials();
}
</script>

<template>
  <AuthShell width="lg">
    <template #brand>
      <BrandLogo tagline="Zero-knowledge vault for what matters" />
    </template>

    <AuthCard>
      <template v-if="phase === 'credentials'">
        <h2 class="text-lg font-semibold">Welcome back</h2>
        <p class="mb-5 mt-1 text-sm text-muted">Sign in to unlock your vault.</p>

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
            class="accent-glow"
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
      </template>

      <TwoFactorChallenge
        v-else
        :loading="loading"
        :error="error"
        :methods="mfaMethods"
        @submit="onMfaSubmit"
        @passkey="onMfaPasskey"
        @back="onMfaBack"
      />
    </AuthCard>

    <template #footer>
      <UIcon name="i-lucide-lock" class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>Encrypted client-side · Argon2id + AES-256-GCM</span>
    </template>
  </AuthShell>
</template>
