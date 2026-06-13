<script setup lang="ts">
// Theme preference — persisted by @nuxtjs/color-mode (localStorage), per device.
// Deliberately NOT in the DB-backed settings: theme is a device concern (a phone
// can be dark while a desktop follows the OS), unlike auto-lock policy.
const colorMode = useColorMode();

const OPTIONS: Array<{ value: string; label: string; icon: string; hint: string }> = [
  { value: 'system', label: 'System', icon: 'i-lucide-monitor', hint: 'follows your OS preference' },
  { value: 'light', label: 'Light', icon: 'i-lucide-sun', hint: 'Jet Stream surfaces, Blue Whale text' },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon', hint: 'Blue Whale surfaces, Jet Stream text' },
];
</script>

<template>
  <div class="rounded-2xl border border-default bg-elevated p-4">
    <div class="mb-3">
      <h3 class="text-base font-semibold">Theme</h3>
      <p class="mt-0.5 text-[13px] text-muted">Stored on this device only</p>
    </div>

    <div class="flex gap-1.5 rounded-xl border border-default bg-accented/40 p-1">
      <button
        v-for="o in OPTIONS"
        :key="o.value"
        type="button"
        :data-testid="`theme-${o.value}`"
        class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition"
        :class="
          colorMode.preference === o.value
            ? 'border border-primary/30 bg-primary/15 text-primary'
            : 'text-muted hover:text-highlighted'
        "
        :aria-pressed="colorMode.preference === o.value"
        :title="o.hint"
        @click="colorMode.preference = o.value"
      >
        <UIcon :name="o.icon" class="size-4 shrink-0" />
        <span class="hidden sm:inline">{{ o.label }}</span>
        <span class="sr-only sm:hidden">{{ o.label }}</span>
      </button>
    </div>
    <p class="mt-2 font-mono text-[11px] text-dimmed">
      {{ OPTIONS.find((o) => o.value === colorMode.preference)?.hint ?? 'follows your OS preference' }}
    </p>
  </div>
</template>
