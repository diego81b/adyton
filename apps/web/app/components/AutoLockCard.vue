<script setup lang="ts">
import { type LockMode } from '@adyton/shared';
import { useSettingsStore } from '~/stores/settings';
import { useCryptoStore } from '~/stores/crypto';

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
  <div class="rounded-2xl border border-default bg-elevated p-4">
    <div class="mb-3">
      <h3 class="text-base font-semibold">Auto-lock</h3>
      <p class="mt-0.5 text-[13px] text-muted">
        The vault key is wiped from memory when the timer fires
      </p>
    </div>

    <div class="mb-1.5 text-sm font-medium text-toned">Timeout (min)</div>
    <div class="flex flex-wrap gap-1.5 rounded-xl border border-default bg-accented/40 p-1">
      <button
        v-for="d in DURATIONS"
        :key="d.ms"
        type="button"
        class="min-w-[60px] flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition"
        :class="
          settings.lockDurationMs === d.ms
            ? 'border border-primary/30 bg-primary/15 text-primary'
            : 'text-muted hover:text-highlighted'
        "
        :aria-pressed="settings.lockDurationMs === d.ms"
        @click="apply({ lockDurationMs: d.ms })"
      >
        {{ d.label }}
      </button>
    </div>
    <p v-if="settings.lockDurationMs === 0" class="mt-2 text-[13px] text-amber-700 dark:text-amber-400">
      The vault stays unlocked until you lock it, close the tab, or reload.
    </p>

    <div class="mb-1.5 mt-4 text-sm font-medium text-toned">Mode</div>
    <div class="flex gap-1.5 rounded-xl border border-default bg-accented/40 p-1">
      <button
        v-for="m in MODES"
        :key="m.value"
        type="button"
        class="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition"
        :class="
          settings.lockMode === m.value
            ? 'border border-primary/30 bg-primary/15 text-primary'
            : 'text-muted hover:text-highlighted'
        "
        :aria-pressed="settings.lockMode === m.value"
        :title="m.hint"
        @click="apply({ lockMode: m.value })"
      >
        {{ m.label }}
      </button>
    </div>
    <p class="mt-2 font-mono text-[11px] text-dimmed">
      {{ MODES.find((m) => m.value === settings.lockMode)?.hint }}
    </p>
  </div>
</template>
