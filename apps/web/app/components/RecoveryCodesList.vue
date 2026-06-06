<script setup lang="ts">
import { useSecureClipboard } from '~/composables/useSecureClipboard';

// Renders the 8 one-time recovery codes in a mono grid with copy-all and
// download actions. Recovery codes are secrets, so copy-all uses the secure
// clipboard (30s auto-clear); download writes a plain .txt blob the user keeps.
const props = defineProps<{ codes: string[] }>();

const { copy, copied } = useSecureClipboard();

async function copyAll() {
  await copy(props.codes.join('\n'));
}

function download() {
  const blob = new Blob([props.codes.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'adyton-recovery-codes.txt';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div>
    <div class="grid grid-cols-2 gap-2">
      <code
        v-for="code in codes"
        :key="code"
        class="rounded-lg border border-default bg-accented px-2.5 py-2 text-center font-mono text-xs tracking-wide text-highlighted"
      >
        {{ code }}
      </code>
    </div>

    <div class="mt-3 flex gap-2">
      <UButton
        color="neutral"
        variant="subtle"
        size="sm"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        class="flex-1 justify-center"
        @click="copyAll"
      >
        {{ copied ? 'Copied' : 'Copy all' }}
      </UButton>
      <UButton
        color="neutral"
        variant="subtle"
        size="sm"
        icon="i-lucide-download"
        class="flex-1 justify-center"
        @click="download"
      >
        Download .txt
      </UButton>
    </div>
  </div>
</template>
