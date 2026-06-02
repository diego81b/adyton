<script setup lang="ts">
// Shown while Argon2id derives the vault key (~1-2s). Reassures the user the
// delay is intentional. Presentational only. Mockup: screen-unlock #unlock-status.
</script>

<template>
  <div class="flex items-center gap-3 rounded-lg border border-default bg-elevated/60 p-3">
    <UIcon name="i-lucide-loader-circle" class="size-5 shrink-0 animate-spin text-primary" />
    <div class="text-xs">
      <div class="font-medium text-highlighted">Deriving encryption key…</div>
      <div class="mt-0.5 text-muted">~1–2 sec for your security</div>
    </div>
  </div>
</template>
