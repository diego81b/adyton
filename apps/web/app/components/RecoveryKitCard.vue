<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import SettingsGroup from './SettingsGroup.vue';
import SettingRow from './SettingRow.vue';

const auth = useAuthStore();

const loading = ref(true);
const revoking = ref(false);
const hasKit = ref(false);
const confirmedAt = ref<string | null>(null);
const error = ref<string | null>(null);

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

async function revokeKit() {
  revoking.value = true;
  error.value = null;
  try {
    await auth.apiFetch('/auth/recovery/setup', { method: 'DELETE' });
    hasKit.value = false;
    confirmedAt.value = null;
  } catch {
    error.value = 'Failed to revoke recovery kit.';
  } finally {
    revoking.value = false;
  }
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
            color="error"
            variant="subtle"
            size="md"
            icon="i-lucide-trash-2"
            aria-label="Revoke recovery kit"
            class="flex-1 justify-center sm:flex-none"
            :loading="revoking"
            @click="revokeKit"
          >
            <span class="hidden sm:inline">Revoke</span>
          </UButton>
        </template>
      </SettingRow>
    </template>

    <template v-else>
      <SettingRow
        label="Recovery kit"
        helper="No recovery kit configured. Enroll a phone to generate one."
        dot="bg-warning"
      />
    </template>
  </SettingsGroup>
</template>
