<script setup lang="ts">
// Swiss-enterprise settings row: one consistent grammar reused by every settings item.
// Mobile: label stacks over a full-width action block (buttons stretch edge-to-edge,
// never cramped). From `sm` up: single row, action right-aligned at its natural width.
defineProps<{
  label: string;
  /** Terse one-line helper under the label. Keep it short. */
  helper?: string;
  /** Plain value shown on the right when no #action slot is provided. */
  value?: string;
  /** Render the value as mono + tabular figures (IPs, ids, data). */
  mono?: boolean;
  /** Status dot colour token class, e.g. `bg-success` / `bg-muted`. */
  dot?: string;
  /** Optional leading icon. */
  icon?: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-x-3 gap-y-2.5 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
    <div class="flex min-w-0 items-center gap-2.5">
      <UIcon v-if="icon" :name="icon" class="size-4 shrink-0 text-dimmed" />
      <span v-if="dot" class="size-2 shrink-0 rounded-full" :class="dot" aria-hidden="true" />
      <div class="min-w-0">
        <div class="text-sm font-medium text-default">{{ label }}</div>
        <p v-if="helper" class="mt-0.5 text-[13px] leading-snug text-muted">{{ helper }}</p>
      </div>
    </div>
    <div class="flex w-full items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
      <slot name="action">
        <span
          v-if="value"
          class="text-sm text-muted"
          :class="mono ? 'font-mono tabular-nums break-all' : ''"
        >{{ value }}</span>
      </slot>
    </div>
  </div>
</template>
