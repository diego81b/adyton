<script setup lang="ts">
import { computed } from 'vue';
import { useReveal } from '~/composables/useReveal';
import { useSecureClipboard } from '~/composables/useSecureClipboard';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string;
    mono?: boolean;
    copyable?: boolean;
    revealable?: boolean;
    /** When set, shows an "open external link" button (LOGIN url). */
    link?: string;
  }>(),
  { mono: true, copyable: true, revealable: false },
);

const toast = useToast();
const { isRevealed, toggle } = useReveal();
const { copy } = useSecureClipboard();

const shown = computed(() =>
  !props.revealable || isRevealed('v') ? props.value : '•'.repeat(Math.min(16, props.value.length || 12)),
);

async function onCopy() {
  const ok = await copy(props.value);
  toast.add(
    ok
      ? { title: 'Copied', description: 'Clears from clipboard in 30s', color: 'success' }
      : { title: 'Copy failed', color: 'error' },
  );
}
</script>

<template>
  <div class="p-4">
    <div class="text-[10px] font-mono uppercase tracking-wider text-dimmed mb-1.5">{{ label }}</div>
    <div class="flex items-center gap-2">
      <span
        class="flex-1 text-sm text-default truncate"
        :class="[mono && 'font-mono', revealable && !isRevealed('v') && 'tracking-wider']"
      >{{ shown }}</span>

      <UButton
        v-if="copyable"
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-copy"
        :aria-label="`Copy ${label}`"
        @click="onCopy"
      />
      <UButton
        v-if="link"
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-external-link"
        :to="link"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="`Open ${label}`"
      />
      <UButton
        v-if="revealable"
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="isRevealed('v') ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="isRevealed('v') ? `Hide ${label}` : `Reveal ${label}`"
        @click="toggle('v')"
      />
    </div>
  </div>
</template>
