<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    loading: boolean;
    error: string | null;
    // Available second factors for this account. WebAuthn is surfaced first (above the
    // code form) when present, per the security design; the code form is the fallback.
    methods?: Array<'totp' | 'webauthn'>;
  }>(),
  { methods: () => ['totp'] },
);

const emit = defineEmits<{
  submit: [payload: { code?: string; recoveryCode?: string }];
  passkey: [];
  back: [];
}>();

const hasPasskey = computed(() => props.methods.includes('webauthn'));

const CODE_RE = /^\d{6}$/;
const RECOVERY_RE = /^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/;

// Two modes: a 6-digit authenticator code (default) or a recovery code fallback.
const useRecovery = ref(false);
const code = ref('');
const recoveryCode = ref('');

const codeValid = computed(() => CODE_RE.test(code.value));
const recoveryValid = computed(() => RECOVERY_RE.test(recoveryCode.value.toLowerCase()));
const canSubmit = computed(() =>
  useRecovery.value ? recoveryValid.value : codeValid.value,
);

function toggleMode() {
  useRecovery.value = !useRecovery.value;
}

function onlyDigits(value: string) {
  code.value = value.replace(/\D/g, '').slice(0, 6);
}

// Auto-submit when a complete 6-digit code is entered — no need to press Enter.
watch(code, (v) => {
  if (v.length === 6 && !useRecovery.value && !props.loading) onSubmit();
});

function onSubmit() {
  if (props.loading || !canSubmit.value) return;
  if (useRecovery.value) {
    emit('submit', { recoveryCode: recoveryCode.value.toLowerCase() });
  } else {
    emit('submit', { code: code.value });
  }
}
</script>

<template>
  <div>
    <h2 class="mb-1 text-lg font-semibold">Two-factor authentication</h2>
    <p class="mb-5 text-sm text-muted">
      {{ useRecovery
        ? 'Enter one of your recovery codes.'
        : 'Enter the 6-digit code from your authenticator app.' }}
    </p>

    <template v-if="hasPasskey">
      <UButton
        type="button"
        block
        size="lg"
        color="primary"
        variant="subtle"
        icon="i-lucide-key-round"
        :disabled="loading"
        @click="emit('passkey')"
      >
        Use a passkey
      </UButton>
      <div class="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-dimmed">
        <span class="h-px flex-1 bg-default" />
        or enter a code
        <span class="h-px flex-1 bg-default" />
      </div>
    </template>

    <UForm :state="{ code, recoveryCode }" class="space-y-5" @submit="onSubmit">
      <UFormField
        v-if="!useRecovery"
        name="code"
        label="Authentication code"
        :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
      >
        <UInput
          :model-value="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          autofocus
          size="lg"
          class="w-full text-center font-mono tracking-[0.4em]"
          placeholder="123456"
          maxlength="6"
          @update:model-value="onlyDigits($event as string)"
        />
      </UFormField>

      <UFormField
        v-else
        name="recoveryCode"
        label="Recovery code"
        :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
      >
        <UInput
          v-model="recoveryCode"
          autocomplete="off"
          autofocus
          size="lg"
          class="w-full font-mono"
          placeholder="xxxxx-xxxxx-xxxxx-xxxxx"
        />
      </UFormField>

      <button
        type="button"
        class="text-xs font-medium text-primary hover:underline"
        @click="toggleMode"
      >
        {{ useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead' }}
      </button>

      <UAlert v-if="error" color="error" variant="soft" :description="error" />

      <UButton
        type="submit"
        block
        size="lg"
        trailing-icon="i-lucide-arrow-right"
        class="accent-glow"
        :loading="loading"
        :disabled="!canSubmit"
      >
        {{ loading ? 'Verifying…' : 'Verify' }}
      </UButton>
    </UForm>

    <p class="mt-5 text-center text-xs text-muted">
      <button
        type="button"
        class="font-medium text-primary hover:underline"
        @click="emit('back')"
      >
        ← Back to sign in
      </button>
    </p>
  </div>
</template>
