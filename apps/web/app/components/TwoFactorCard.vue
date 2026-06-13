<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '~/stores/auth';
import TwoFactorSetupModal from './TwoFactorSetupModal.vue';
import PasswordPromptModal from './PasswordPromptModal.vue';
import RecoveryCodesModal from './RecoveryCodesModal.vue';
import SettingRow from './SettingRow.vue';

// Account-level 2FA management. The auth store's `user.totpEnabled` is the source
// of truth (it refreshes on the next /auth/me); we flip it locally after enable /
// disable so the card reflects the new state immediately. This card owns every
// request — the modals stay dumb/reusable.
const auth = useAuthStore();
const toast = useToast();

const enabled = computed(() => auth.user?.totpEnabled ?? false);

// --- Enable (setup wizard) ---------------------------------------------------
const setupOpen = ref(false);

function onEnabled() {
  if (auth.user) auth.user.totpEnabled = true;
  toast.add({ title: 'Two-factor authentication enabled', color: 'success' });
}

// --- Disable -----------------------------------------------------------------
const disableOpen = ref(false);
const disableLoading = ref(false);
const disableError = ref<string | null>(null);

function openDisable() {
  disableError.value = null;
  disableOpen.value = true;
}

async function confirmDisable(password: string) {
  disableLoading.value = true;
  disableError.value = null;
  try {
    await auth.apiFetch('/auth/2fa/disable', { method: 'POST', body: { password } });
    if (auth.user) auth.user.totpEnabled = false;
    disableOpen.value = false;
    toast.add({ title: 'Two-factor authentication disabled', color: 'success' });
  } catch (err) {
    disableError.value = mapPasswordError(err);
  } finally {
    disableLoading.value = false;
  }
}

// --- Regenerate recovery codes -----------------------------------------------
const regenPromptOpen = ref(false);
const regenLoading = ref(false);
const regenError = ref<string | null>(null);
const codesOpen = ref(false);
const newCodes = ref<string[]>([]);

function openRegenerate() {
  regenError.value = null;
  regenPromptOpen.value = true;
}

async function confirmRegenerate(password: string) {
  regenLoading.value = true;
  regenError.value = null;
  try {
    const res = await auth.apiFetch<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', {
      method: 'POST',
      body: { password },
    });
    newCodes.value = res.recoveryCodes;
    regenPromptOpen.value = false;
    codesOpen.value = true;
  } catch (err) {
    regenError.value = mapPasswordError(err);
  } finally {
    regenLoading.value = false;
  }
}

function mapPasswordError(err: unknown): string {
  const status =
    (err as { statusCode?: number; status?: number })?.statusCode ??
    (err as { status?: number })?.status;
  return status === 401 ? 'Invalid credentials' : 'Something went wrong. Please try again.';
}
</script>

<template>
  <SettingRow
    label="Two-factor authentication"
    :helper="enabled ? 'Required at every login' : 'One-time code from your authenticator app'"
    :dot="enabled ? 'bg-success' : 'bg-surface-400'"
  >
    <template #action>
      <template v-if="enabled">
        <UButton
          color="neutral"
          variant="subtle"
          size="md"
          icon="i-lucide-refresh-cw"
          aria-label="Regenerate recovery codes"
          class="flex-1 justify-center sm:flex-none"
          @click="openRegenerate"
        >
          Recovery codes
        </UButton>
        <UButton
          color="error"
          variant="subtle"
          size="md"
          icon="i-lucide-shield-off"
          aria-label="Disable two-factor authentication"
          class="flex-1 justify-center sm:flex-none"
          @click="openDisable"
        >
          Disable
        </UButton>
      </template>
      <UButton
        v-else
        color="primary"
        variant="subtle"
        size="md"
        icon="i-lucide-shield-plus"
        aria-label="Enable 2FA"
        class="flex-1 justify-center sm:flex-none"
        @click="setupOpen = true"
      >
        Enable
      </UButton>
    </template>
  </SettingRow>

  <TwoFactorSetupModal v-model:open="setupOpen" @enabled="onEnabled" />

  <PasswordPromptModal
    v-model:open="disableOpen"
    title="Disable two-factor authentication"
    confirm-label="Disable 2FA"
    danger
    :loading="disableLoading"
    :error="disableError"
    @confirm="confirmDisable"
  />

  <PasswordPromptModal
    v-model:open="regenPromptOpen"
    title="Regenerate recovery codes"
    confirm-label="Regenerate"
    :loading="regenLoading"
    :error="regenError"
    @confirm="confirmRegenerate"
  />

  <RecoveryCodesModal v-model:open="codesOpen" :codes="newCodes" />
</template>
