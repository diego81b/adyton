<script setup lang="ts">
import SettingRow from './SettingRow.vue';

// Theme preference — persisted by @nuxtjs/color-mode (localStorage), per device.
// Deliberately NOT in the DB-backed settings: theme is a device concern.
const colorMode = useColorMode();

const OPTIONS: Array<{ value: string; label: string; icon: string }> = [
  { value: 'system', label: 'System', icon: 'i-lucide-monitor' },
  { value: 'light', label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
];
</script>

<template>
  <SettingRow label="Theme" helper="Stored on this device only">
    <template #action>
      <div class="flex w-full gap-1 rounded-md bg-muted p-1 sm:w-auto">
        <button
          v-for="o in OPTIONS"
          :key="o.value"
          type="button"
          :data-testid="`theme-${o.value}`"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition sm:flex-none sm:min-w-24"
          :class="
            colorMode.preference === o.value
              ? 'bg-primary/15 text-primary'
              : 'text-muted hover:text-highlighted'
          "
          :aria-pressed="colorMode.preference === o.value"
          :title="o.label"
          @click="colorMode.preference = o.value"
        >
          <UIcon :name="o.icon" class="size-4 shrink-0" />
          <span>{{ o.label }}</span>
        </button>
      </div>
    </template>
  </SettingRow>
</template>
