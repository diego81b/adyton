<script setup lang="ts">
import { computed } from 'vue';
import type { DecryptedEntry } from '@adyton/shared';
import { useReveal } from '~/composables/useReveal';
import { useSecureClipboard } from '~/composables/useSecureClipboard';
import { detectEnvFormat } from '~/utils/vault-crypto';

const props = defineProps<{ entry: DecryptedEntry }>();

const toast = useToast();
const { isRevealed, toggle } = useReveal();
const { copy } = useSecureClipboard();

const rows = computed(() => Object.entries(props.entry.envParsed ?? {}));
const content = computed(() => props.entry.envContent ?? '');
const format = computed(() => detectEnvFormat(content.value));

// JSON env files (.NET appsettings.json etc.) have no KEY=VALUE lines, so the table
// would render empty while the blob holds the full content. Fall back to a raw
// viewer for JSON — or for any content the dotenv parser couldn't extract rows from.
const showRaw = computed(
  () => content.value.trim() !== '' && (format.value === 'json' || rows.value.length === 0),
);

// Pretty-print valid JSON for readability; keep the original text verbatim otherwise.
const rawDisplay = computed(() => {
  if (format.value === 'json') {
    try {
      return JSON.stringify(JSON.parse(content.value), null, 2);
    } catch {
      // malformed JSON — show as-is
    }
  }
  return content.value;
});

const RAW_KEY = '__raw__';

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

// Full-file export path (never copy the whole file to clipboard — invariant #8 / nuxt.md §6.7).
// Extension follows the detected format so appsettings-style files round-trip as .json.
function downloadEnv() {
  const ext = format.value === 'json' ? 'json' : 'env';
  const mime = format.value === 'json' ? 'application/json' : 'text/plain';
  const blob = new Blob([content.value], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${props.entry.label || 'secrets'}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

defineExpose({ downloadEnv });
</script>

<template>
  <div class="bg-elevated border border-default rounded-lg overflow-hidden">
    <!-- Raw viewer: JSON or unparseable content -->
    <template v-if="showRaw">
      <div class="flex items-center justify-between px-4 py-2.5 bg-elevated/60 border-b border-default">
        <span class="text-[11px] font-mono uppercase tracking-wider text-dimmed">
          {{ format === 'json' ? 'JSON file' : 'Raw file' }}
        </span>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :icon="isRevealed(RAW_KEY) ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          :aria-label="isRevealed(RAW_KEY) ? 'Hide content' : 'Reveal content'"
          @click="toggle(RAW_KEY)"
        />
      </div>
      <pre
        v-if="isRevealed(RAW_KEY)"
        data-testid="raw-content"
        class="px-4 py-3 font-mono text-sm text-muted whitespace-pre-wrap break-all max-h-96 overflow-y-auto"
      >{{ rawDisplay }}</pre>
      <div v-else class="px-4 py-8 text-center text-sm text-muted">
        Content hidden — reveal to view, or use Download for the full file.
      </div>
    </template>

    <!-- dotenv key/value table -->
    <template v-else>
      <div
        class="hidden sm:grid grid-cols-[1fr_2fr_auto] gap-3 px-4 py-2.5 bg-elevated/60 border-b border-default"
      >
        <div class="text-[11px] font-mono uppercase tracking-wider text-dimmed">Key</div>
        <div class="text-[11px] font-mono uppercase tracking-wider text-dimmed">Value</div>
        <div class="w-[68px]" />
      </div>

      <div v-if="rows.length" class="divide-y divide-default">
        <div
          v-for="[key, value] in rows"
          :key="key"
          class="sm:grid sm:grid-cols-[1fr_2fr_auto] gap-3 px-4 py-3 sm:items-center hover:bg-elevated/30 transition"
        >
          <div class="font-mono text-base font-semibold text-default mb-1 sm:mb-0 break-all">{{ key }}</div>
          <div
            class="font-mono text-base text-muted truncate"
            :class="!isRevealed(key) && 'tracking-wider'"
          >{{ isRevealed(key) ? value : masked(value) }}</div>
          <div class="flex gap-1 mt-1 sm:mt-0 justify-end">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-copy"
              :aria-label="`Copy ${key}`"
              @click="copyValue(key, value)"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :icon="isRevealed(key) ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :aria-label="isRevealed(key) ? `Hide ${key}` : `Reveal ${key}`"
              @click="toggle(key)"
            />
          </div>
        </div>
      </div>

      <div v-else class="px-4 py-8 text-center text-sm text-muted">No variables in this file.</div>
    </template>
  </div>
</template>
