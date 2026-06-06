<script setup lang="ts">
import { computed } from 'vue';
import type { StrengthTier } from '~/composables/useGenerator';

const props = defineProps<{
  bits: number;
  strength: StrengthTier;
}>();

const rounded = computed(() => Math.round(props.bits));
// 100+ bits fills the ring completely; the scale is informative, not linear-forever.
const ringStyle = computed(() => ({ '--progress': `${Math.min(props.bits, 100)}%` }));
</script>

<template>
  <div class="flex items-center gap-4 rounded-2xl border border-default bg-elevated p-4">
    <div class="relative h-14 w-14 shrink-0">
      <div class="totp-ring absolute inset-0 rounded-full" :style="ringStyle" />
      <div
        class="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold text-primary"
      >{{ rounded }}</div>
    </div>
    <div class="flex-1">
      <div class="text-xs font-semibold text-highlighted">~{{ rounded }} bits of entropy</div>
      <div class="mt-0.5 text-[11px] text-muted">{{ strength.description }}</div>
    </div>
    <span
      class="rounded-full border px-2 py-1 font-mono text-[10px] font-bold uppercase"
      :class="strength.badgeClass"
    >{{ strength.label }}</span>
  </div>
</template>
