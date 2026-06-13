<script setup lang="ts">
import { computed } from 'vue';
import { type LockMode } from '@adyton/shared';
import { useSettingsStore } from '~/stores/settings';
import { useCryptoStore } from '~/stores/crypto';
import SettingRow from './SettingRow.vue';

// Auto-lock policy — persisted per-user (DB-backed settings store).
const settings = useSettingsStore();
const crypto = useCryptoStore();
const toast = useToast();

const DURATIONS: Array<{ label: string; ms: number }> = [
  { label: '5', ms: 5 * 60_000 },
  { label: '15', ms: 15 * 60_000 },
  { label: '30', ms: 30 * 60_000 },
  { label: '60', ms: 60 * 60_000 },
  { label: 'Never', ms: 0 },
];

const MODES: Array<{ label: string; value: LockMode; hint: string }> = [
  { label: 'On inactivity', value: 'activity', hint: 'timer resets while you use the app' },
  { label: 'Fixed interval', value: 'absolute', hint: 'locks on schedule regardless of activity' },
];

const timeoutHelper = computed(() =>
  settings.lockDurationMs === 0
    ? 'Stays unlocked until you lock it, close the tab, or reload'
    : 'Vault key wiped from memory when the timer fires',
);
const modeHelper = computed(
  () => MODES.find((m) => m.value === settings.lockMode)?.hint ?? '',
);

async function apply(patch: Partial<{ lockDurationMs: number; lockMode: LockMode }>) {
  try {
    await settings.updateSettings(patch);
    // Re-arm the running timer so the new policy applies immediately.
    if (crypto.isUnlocked) crypto.resetLockTimer();
  } catch {
    toast.add({ title: 'Could not save auto-lock setting', color: 'error' });
  }
}
</script>

<template>
  <SettingRow label="Auto-lock timeout" :helper="timeoutHelper">
    <template #action>
      <div class="flex w-full gap-1 rounded-md bg-muted p-1 sm:w-auto">
        <button
          v-for="d in DURATIONS"
          :key="d.ms"
          type="button"
          class="flex-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium tabular-nums transition sm:flex-none sm:min-w-16"
          :class="
            settings.lockDurationMs === d.ms
              ? 'bg-primary/15 text-primary'
              : 'text-muted hover:text-highlighted'
          "
          :aria-pressed="settings.lockDurationMs === d.ms"
          @click="apply({ lockDurationMs: d.ms })"
        >
          {{ d.label }}
        </button>
      </div>
    </template>
  </SettingRow>

  <SettingRow label="Lock mode" :helper="modeHelper">
    <template #action>
      <div class="flex w-full gap-1 rounded-md bg-muted p-1 sm:w-auto">
        <button
          v-for="m in MODES"
          :key="m.value"
          type="button"
          class="flex-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition sm:flex-none sm:min-w-32"
          :class="
            settings.lockMode === m.value
              ? 'bg-primary/15 text-primary'
              : 'text-muted hover:text-highlighted'
          "
          :aria-pressed="settings.lockMode === m.value"
          :title="m.hint"
          @click="apply({ lockMode: m.value })"
        >
          {{ m.label }}
        </button>
      </div>
    </template>
  </SettingRow>
</template>
