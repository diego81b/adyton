<script setup lang="ts">
// Swiss-enterprise section: a quiet uppercase label over a single hairline container.
// Rows inside are separated by `divide-y` (no card-in-card). This is the only bordered
// surface in settings — the "L1" elevation level.
defineProps<{
  title: string;
  /** Optional terse inline subtitle (e.g. a count). */
  subtitle?: string;
  /** Error-toned variant for the danger zone. */
  danger?: boolean;
  /** Anchor id for in-page scroll targets. */
  id?: string;
}>();
</script>

<template>
  <section :id="id" class="scroll-mt-20">
    <h2
      class="mb-2 px-0.5 text-[13px] font-semibold uppercase tracking-wide"
      :class="danger ? 'text-error' : 'text-muted'"
    >
      {{ title }}
      <span v-if="subtitle" class="ml-1.5 text-xs font-normal normal-case tracking-normal text-dimmed">
        {{ subtitle }}
      </span>
    </h2>
    <div
      class="divide-y divide-default overflow-hidden rounded-lg border"
      :class="danger ? 'border-error/30 bg-error/5' : 'border-default bg-elevated'"
    >
      <slot />
    </div>
  </section>
</template>
