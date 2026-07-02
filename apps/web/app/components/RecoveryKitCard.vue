<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useRecoveryKitRegenerate } from '~/composables/useRecoveryKitRegenerate';
import SettingsGroup from './SettingsGroup.vue';
import SettingRow from './SettingRow.vue';
import PasswordPromptModal from './PasswordPromptModal.vue';
import RecoveryKitSetupStep from './RecoveryKitSetupStep.vue';

const auth = useAuthStore();
const regenerate = useRecoveryKitRegenerate();

const loading = ref(true);
const hasKit = ref(false);
const confirmedAt = ref<string | null>(null);
const error = ref<string | null>(null);

const showPasswordPrompt = ref(false);
const showMnemonic = ref(false);

async function fetchStatus() {
  loading.value = true;
  error.value = null;
  try {
    const result = await auth.apiFetch<{ hasKit: boolean; confirmedAt?: string }>(
      '/auth/recovery/status',
    );
    hasKit.value = result.hasKit;
    confirmedAt.value = result.confirmedAt ?? null;
  } catch {
    error.value = 'Could not load recovery kit status.';
  } finally {
    loading.value = false;
  }
}

function openRegenerate() {
  regenerate.reset();
  showPasswordPrompt.value = true;
}

async function onPasswordConfirm(password: string) {
  const ok = await regenerate.regenerate(password);
  if (ok) {
    showPasswordPrompt.value = false;
    showMnemonic.value = true;
  }
  // On failure regenerate.error is shown inline in the password modal; it stays open.
}

async function onMnemonicConfirmed() {
  showMnemonic.value = false;
  regenerate.reset();
  await fetchStatus();
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

onMounted(() => void fetchStatus());
</script>

<template>
  <SettingsGroup title="Recovery kit">
    <template v-if="loading">
      <SettingRow label="Recovery kit" helper="Loading…" />
    </template>

    <template v-else-if="error">
      <SettingRow label="Recovery kit" :helper="error" />
    </template>

    <template v-else-if="hasKit">
      <SettingRow
        label="Recovery kit"
        :helper="confirmedAt ? `Configured ${formatDate(confirmedAt)}` : 'Active'"
        dot="bg-success"
      >
        <template #action>
          <UButton
            color="neutral"
            variant="subtle"
            size="md"
            icon="i-lucide-refresh-cw"
            aria-label="Regenerate recovery kit"
            class="flex-1 justify-center sm:flex-none"
            @click="openRegenerate"
          >
            <span class="hidden sm:inline">Regenerate</span>
          </UButton>
        </template>
      </SettingRow>
    </template>

    <template v-else>
      <SettingRow
        label="Recovery kit"
        helper="No recovery kit configured. Generate one to recover your vault without a phone."
        dot="bg-warning"
      >
        <template #action>
          <UButton
            color="primary"
            variant="subtle"
            size="md"
            icon="i-lucide-key-round"
            aria-label="Generate recovery kit"
            class="flex-1 justify-center sm:flex-none"
            @click="openRegenerate"
          >
            <span class="hidden sm:inline">Generate</span>
          </UButton>
        </template>
      </SettingRow>
    </template>

    <!-- Password confirmation before (re)generating the kit -->
    <PasswordPromptModal
      v-model:open="showPasswordPrompt"
      :title="hasKit ? 'Regenerate recovery kit' : 'Generate recovery kit'"
      confirm-label="Continue"
      :loading="regenerate.loading.value"
      :error="regenerate.error.value"
      @confirm="onPasswordConfirm"
    />

    <!-- New mnemonic — shown once, must be written down before dismissing -->
    <UModal
      :open="showMnemonic"
      title="Your new recovery phrase"
      :dismissible="false"
      :close="false"
    >
      <template #content>
        <div class="p-5">
          <p class="mb-4 text-sm leading-relaxed text-toned">
            This replaces any previous recovery phrase — the old one no longer works.
          </p>
          <RecoveryKitSetupStep
            :mnemonic="regenerate.mnemonic.value ?? []"
            :loading="false"
            @confirm="onMnemonicConfirmed"
          />
        </div>
      </template>
    </UModal>
  </SettingsGroup>
</template>
