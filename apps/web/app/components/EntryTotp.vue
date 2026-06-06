<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useTotp } from '~/composables/useTotp';
import { useSecureClipboard } from '~/composables/useSecureClipboard';

const props = defineProps<{ secret: string }>();

const toast = useToast();
const { code, remaining, error, progress } = useTotp(toRef(props, 'secret'));
const { copy } = useSecureClipboard();

// Grouped as "847 291" for readability; copies the raw digits.
const display = computed(() =>
  code.value ? `${code.value.slice(0, 3)} ${code.value.slice(3)}` : '••• •••',
);
const ringStyle = computed(() => ({ '--progress': `${progress() * 100}%` }));

async function onCopy() {
  if (!code.value) return;
  const ok = await copy(code.value);
  toast.add(
    ok
      ? { title: 'TOTP copied', description: 'Clears from clipboard in 30s', color: 'success' }
      : { title: 'Copy failed', color: 'error' },
  );
}
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-1.5">
      <span class="text-[10px] font-mono uppercase tracking-wider text-dimmed">TOTP</span>
      <span class="text-[10px] font-mono text-dimmed">rotates every 30s</span>
    </div>

    <div v-if="error" class="text-xs text-error">Invalid TOTP secret (not valid base32).</div>

    <div v-else class="flex items-center gap-3">
      <div class="relative w-8 h-8 shrink-0">
        <div class="totp-ring absolute inset-0 rounded-full" :style="ringStyle" />
        <div
          class="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-semibold text-muted"
        >{{ remaining }}</div>
      </div>
      <span class="flex-1 text-2xl font-mono font-semibold tracking-[0.2em] text-primary">{{ display }}</span>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-copy"
        aria-label="Copy TOTP code"
        @click="onCopy"
      />
    </div>
  </div>
</template>
