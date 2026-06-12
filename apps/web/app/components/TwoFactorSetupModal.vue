<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useSecureClipboard } from '~/composables/useSecureClipboard';
import RecoveryCodesList from './RecoveryCodesList.vue';

// Three-step TOTP enrollment wizard:
//   scan     — POST /auth/2fa/setup on open, show QR + manual secret
//   verify   — 6-digit code → POST /auth/2fa/enable, returns recovery codes
//   recovery — show codes once; acknowledgment gates the only close action.
// Steps a/b are freely dismissible (the pending secret is harmless server-side);
// step c locks the modal so the user cannot lose the one-time codes.
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ enabled: [] }>();

const auth = useAuthStore();
const { copy: copySecret, copied: secretCopied } = useSecureClipboard();

type Step = 'scan' | 'verify' | 'recovery';
const step = ref<Step>('scan');

const otpauthSecret = ref('');
const qrDataUri = ref('');
const setupLoading = ref(false);
const setupError = ref<string | null>(null);

const code = ref('');
const verifyLoading = ref(false);
const verifyError = ref<string | null>(null);

const recoveryCodes = ref<string[]>([]);
const acknowledged = ref(false);

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      // Fresh wizard on every open (including an already-open mount).
      step.value = 'scan';
      otpauthSecret.value = '';
      qrDataUri.value = '';
      setupError.value = null;
      code.value = '';
      verifyError.value = null;
      recoveryCodes.value = [];
      acknowledged.value = false;
      void runSetup();
    }
  },
  { immediate: true },
);

async function runSetup() {
  setupLoading.value = true;
  setupError.value = null;
  try {
    const res = await auth.apiFetch<{ secret: string; otpauthUri: string; qrDataUri: string }>(
      '/auth/2fa/setup',
      { method: 'POST' },
    );
    otpauthSecret.value = res.secret;
    qrDataUri.value = res.qrDataUri;
  } catch {
    setupError.value = 'Could not start setup. Please try again.';
  } finally {
    setupLoading.value = false;
  }
}

async function verify() {
  if (code.value.length !== 6 || verifyLoading.value) return;
  verifyLoading.value = true;
  verifyError.value = null;
  try {
    const res = await auth.apiFetch<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
      method: 'POST',
      body: { code: code.value },
    });
    recoveryCodes.value = res.recoveryCodes;
    step.value = 'recovery';
  } catch (err) {
    const status =
      (err as { statusCode?: number; status?: number })?.statusCode ??
      (err as { status?: number })?.status;
    verifyError.value =
      status === 401 ? 'Invalid code. Check your authenticator and try again.' : 'Verification failed. Please try again.';
  } finally {
    verifyLoading.value = false;
  }
}

function onlyDigits(value: string) {
  code.value = value.replace(/\D/g, '').slice(0, 6);
}

// Auto-submit when a complete 6-digit code is entered — no need to press Enter.
watch(code, (v) => {
  if (v.length === 6 && !verifyLoading.value) void verify();
});

function finish() {
  if (!acknowledged.value) return;
  emit('enabled');
  open.value = false;
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Enable two-factor authentication"
    :dismissible="step !== 'recovery'"
    :close="step !== 'recovery'"
  >
    <template #content>
      <div class="p-5">
        <!-- ===== Step a: scan ===== -->
        <div v-if="step === 'scan'">
          <p class="text-sm leading-relaxed text-toned">
            Scan this QR code with your authenticator app (1Password, Authy, Google
            Authenticator…).
          </p>

          <div v-if="setupLoading" class="py-10 text-center text-sm text-muted">
            Generating secret…
          </div>
          <div v-else-if="setupError" class="py-6">
            <UAlert color="error" variant="subtle" :title="setupError" />
            <UButton color="neutral" variant="subtle" size="sm" class="mt-3" @click="runSetup">
              Retry
            </UButton>
          </div>
          <template v-else>
            <div class="mt-4 flex justify-center">
              <img
                :src="qrDataUri"
                alt="TOTP QR code"
                class="size-52 rounded-lg bg-white p-2"
                width="208"
                height="208"
              />
            </div>

            <div class="mt-4">
              <p class="text-[11px] text-muted">Can't scan? Enter the code manually</p>
              <button
                type="button"
                class="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-default bg-accented px-3 py-2 text-left transition hover:border-primary/40"
                @click="copySecret(otpauthSecret)"
              >
                <code class="truncate font-mono text-xs tracking-wide text-highlighted">
                  {{ otpauthSecret }}
                </code>
                <UIcon
                  :name="secretCopied ? 'i-lucide-check' : 'i-lucide-copy'"
                  class="size-3.5 shrink-0 text-muted"
                />
              </button>
            </div>

            <UButton
              color="primary"
              size="lg"
              block
              class="mt-5"
              @click="step = 'verify'"
            >
              Continue
            </UButton>
          </template>
        </div>

        <!-- ===== Step b: verify ===== -->
        <div v-else-if="step === 'verify'">
          <p class="text-sm leading-relaxed text-toned">
            Enter the 6-digit code from your authenticator app to confirm the link.
          </p>

          <div class="mt-4">
            <UFormField label="Verification code" name="code">
              <UInput
                :model-value="code"
                size="lg"
                class="w-full text-center font-mono tracking-[0.4em]"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="123456"
                maxlength="6"
                autofocus
                @update:model-value="onlyDigits($event as string)"
                @keydown.enter="verify"
              />
            </UFormField>
            <UAlert
              v-if="verifyError"
              color="error"
              variant="subtle"
              class="mt-3"
              :title="verifyError"
            />
          </div>

          <div class="mt-5 flex gap-2">
            <UButton
              color="neutral"
              variant="soft"
              size="lg"
              class="flex-1 justify-center"
              @click="step = 'scan'"
            >
              Back
            </UButton>
            <UButton
              color="primary"
              size="lg"
              class="flex-1 justify-center"
              :disabled="code.length !== 6"
              :loading="verifyLoading"
              @click="verify"
            >
              Verify &amp; enable
            </UButton>
          </div>
        </div>

        <!-- ===== Step c: recovery ===== -->
        <div v-else>
          <div class="mb-3 flex items-center gap-2.5">
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15"
            >
              <UIcon name="i-lucide-shield-check" class="size-4 text-emerald-400" />
            </div>
            <h2 class="font-bold tracking-tight">Save your recovery codes</h2>
          </div>

          <p class="text-sm leading-relaxed text-toned">
            Store these somewhere safe. Each code works once if you lose access to your
            authenticator. They are
            <strong class="text-highlighted">shown only now</strong> and cannot be retrieved later.
          </p>

          <div class="mt-4">
            <RecoveryCodesList :codes="recoveryCodes" />
          </div>

          <label class="mt-4 flex items-start gap-2.5">
            <UCheckbox v-model="acknowledged" />
            <span class="text-xs leading-relaxed text-toned">
              I saved these codes — they are shown only once
            </span>
          </label>

          <UButton
            color="primary"
            size="lg"
            block
            class="mt-5"
            :disabled="!acknowledged"
            @click="finish"
          >
            Done
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
