<script setup lang="ts">
// Presentational strength meter: 4 segments + label + entropy readout.
// All derived state is passed in (props down) from usePasswordStrength.
defineProps<{
  score: number;
  label: string;
  labelColor: string;
  bits: number;
  segColor: string;
  validating: boolean;
}>();
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex gap-1.5">
      <div
        v-for="i in 4"
        :key="i"
        class="h-1 flex-1 rounded-full transition-colors"
        :class="i <= score ? '' : 'bg-accented'"
        :style="i <= score ? { background: segColor } : undefined"
      />
    </div>
    <div class="flex justify-between text-[11px]">
      <span v-if="validating" class="text-muted">Checking…</span>
      <span v-else :style="{ color: labelColor }">{{ label }}</span>
      <span class="font-mono text-muted">{{ bits }} bits</span>
    </div>
  </div>
</template>
