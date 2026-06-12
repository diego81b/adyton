<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  value: string;
  /** Passphrase words — when set, renders word-alternating colors instead of per-char classes. */
  words?: string[];
  error?: string;
}>();

defineEmits<{ copy: []; regenerate: [] }>();

interface Segment {
  text: string;
  class: string;
}

// Per-character classes mirror the mockup: digits accent, uppercase amber,
// symbols rose, lowercase default. Passphrase alternates word color with dim separators.
const segments = computed<Segment[]>(() => {
  if (props.words?.length) {
    return props.words.flatMap((word, i) => {
      const seg: Segment[] = [{ text: word, class: i % 2 ? 'text-primary' : '' }];
      if (i < props.words!.length - 1) seg.push({ text: '-', class: 'text-dimmed' });
      return seg;
    });
  }
  return [...props.value].map((c) => {
    if (/[0-9]/.test(c)) return { text: c, class: 'text-primary' };
    if (/[A-Z]/.test(c)) return { text: c, class: 'text-amber-300' };
    if (/[^a-zA-Z0-9]/.test(c)) return { text: c, class: 'text-rose-300' };
    return { text: c, class: '' };
  });
});
</script>

<template>
  <div class="relative overflow-hidden rounded-2xl border border-default bg-elevated p-5">
    <div
      class="pointer-events-none absolute top-0 right-0 h-32 w-32 -translate-y-12 translate-x-12 rounded-full bg-primary/10 blur-3xl"
    />

    <div class="mb-3 font-mono text-[11px] uppercase tracking-wider text-dimmed">
      Generated {{ words?.length ? 'Passphrase' : 'Password' }}
    </div>

    <p v-if="error" class="mb-4 text-base text-error">{{ error }}</p>
    <div
      v-else
      data-testid="generated-value"
      class="relative mb-4 break-all font-mono text-xl font-semibold leading-relaxed tracking-wider sm:text-2xl"
    >
      <span v-for="(seg, i) in segments" :key="i" :class="seg.class">{{ seg.text }}</span>
    </div>

    <div class="flex gap-2">
      <UButton
        class="flex-1 justify-center text-white"
        color="primary"
        size="lg"
        icon="i-lucide-copy"
        :disabled="!value"
        @click="$emit('copy')"
      >
        Copy
      </UButton>
      <UButton
        color="neutral"
        variant="subtle"
        size="lg"
        icon="i-lucide-refresh-cw"
        aria-label="Regenerate"
        :disabled="!!error"
        @click="$emit('regenerate')"
      >
        <span class="hidden sm:inline">Regenerate</span>
      </UButton>
    </div>
  </div>
</template>
