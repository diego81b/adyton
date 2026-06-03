<script setup lang="ts">
import { computed } from 'vue';
import type { DecryptedEntry } from '@adyton/shared';
import { useReveal } from '~/composables/useReveal';
import { useSecureClipboard } from '~/composables/useSecureClipboard';

const props = defineProps<{ entry: DecryptedEntry }>();

const toast = useToast();
const { isRevealed, toggle } = useReveal();
const { copy } = useSecureClipboard();

const rows = computed(() => Object.entries(props.entry.envParsed ?? {}));

function masked(value: string): string {
  return '•'.repeat(Math.min(16, value.length || 12));
}

async function copyValue(key: string, value: string) {
  const ok = await copy(value);
  toast.add(
    ok
      ? { title: `Copied ${key}`, description: 'Clears from clipboard in 30s', color: 'success' }
      : { title: 'Copy failed', color: 'error' },
  );
}

// Full-file export path (never copy the whole .env to clipboard — invariant #8 / nuxt.md §6.7).
function downloadEnv() {
  const content = props.entry.envContent ?? '';
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${props.entry.label || 'secrets'}.env`;
  a.click();
  URL.revokeObjectURL(url);
}

defineExpose({ downloadEnv });
</script>

<template>
  <div class="bg-elevated/40 border border-default rounded-2xl overflow-hidden">
    <div
      class="hidden sm:grid grid-cols-[1fr_2fr_auto] gap-3 px-4 py-2.5 bg-elevated/60 border-b border-default"
    >
      <div class="text-[10px] font-mono uppercase tracking-wider text-dimmed">Key</div>
      <div class="text-[10px] font-mono uppercase tracking-wider text-dimmed">Value</div>
      <div class="w-[68px]" />
    </div>

    <div v-if="rows.length" class="divide-y divide-default">
      <div
        v-for="[key, value] in rows"
        :key="key"
        class="sm:grid sm:grid-cols-[1fr_2fr_auto] gap-3 px-4 py-3 sm:items-center hover:bg-elevated/30 transition"
      >
        <div class="font-mono text-sm font-semibold text-default mb-1 sm:mb-0 break-all">{{ key }}</div>
        <div
          class="font-mono text-sm text-muted truncate"
          :class="!isRevealed(key) && 'tracking-wider'"
        >{{ isRevealed(key) ? value : masked(value) }}</div>
        <div class="flex gap-1 mt-1 sm:mt-0 justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-copy"
            :aria-label="`Copy ${key}`"
            @click="copyValue(key, value)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :icon="isRevealed(key) ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :aria-label="isRevealed(key) ? `Hide ${key}` : `Reveal ${key}`"
            @click="toggle(key)"
          />
        </div>
      </div>
    </div>

    <div v-else class="px-4 py-8 text-center text-sm text-muted">No variables in this file.</div>
  </div>
</template>
