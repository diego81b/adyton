<script setup lang="ts">
// Progress indicator for the unlock flow. Defaults describe the Argon2id key
// derivation; the unlock page overrides title/hint for the subsequent vault-load
// phase so the spinner stays continuous and self-explanatory. Presentational only.
withDefaults(
  defineProps<{ title?: string; hint?: string }>(),
  { title: 'Deriving encryption key…', hint: '~1–2 sec for your security' },
);
</script>

<template>
  <div class="flex items-center gap-3 rounded-lg border border-default bg-elevated/60 p-3">
    <UIcon name="i-lucide-loader-circle" class="size-5 shrink-0 animate-spin text-primary" />
    <div class="text-xs">
      <div class="font-medium text-highlighted">{{ title }}</div>
      <div class="mt-0.5 text-muted">{{ hint }}</div>
    </div>
  </div>
</template>
