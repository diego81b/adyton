<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '~/stores/auth';
import TwoFactorSetupModal from './TwoFactorSetupModal.vue';
import PasswordPromptModal from './PasswordPromptModal.vue';
import RecoveryCodesModal from './RecoveryCodesModal.vue';

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
  <div class="rounded-2xl border border-default bg-elevated p-4">
    <div class="mb-0.5 flex items-center gap-2">
      <h3 class="text-base font-semibold">Two-factor authentication</h3>
      <span
        v-if="enabled"
        class="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-300"
      >
        <span class="size-1.5 rounded-full bg-emerald-400" />
        Enabled
      </span>
      <span
        v-else
        class="rounded-full border border-default bg-accented px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-muted"
      >
        Not configured
      </span>
    </div>

    <!-- Enabled state -->
    <template v-if="enabled">
      <p class="text-[13px] text-muted">Required at every login</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <UButton
          color="neutral"
          variant="subtle"
          size="md"
          icon="i-lucide-refresh-cw"
          aria-label="Regenerate recovery codes"
          @click="openRegenerate"
        >
          Regenerate recovery codes
        </UButton>
        <UButton
          color="error"
          variant="subtle"
          size="md"
          icon="i-lucide-shield-off"
          aria-label="Disable two-factor authentication"
          @click="openDisable"
        >
          Disable
        </UButton>
      </div>
    </template>

    <!-- Disabled state -->
    <template v-else>
      <p class="text-[13px] text-muted">
        Add a one-time code from your authenticator app at every login.
      </p>
      <UButton
        color="primary"
        variant="subtle"
        size="md"
        icon="i-lucide-shield-plus"
        aria-label="Enable 2FA"
        class="mt-4"
        @click="setupOpen = true"
      >
        Enable 2FA
      </UButton>
    </template>

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
  </div>
</template>
