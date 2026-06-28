<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  mnemonic: readonly string[];
  loading: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
}>();

const confirmed = ref(false);
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function copyAll() {
  void navigator.clipboard.writeText(props.mnemonic.join(' ')).then(() => {
    copied.value = true;
    if (copyTimer !== null) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = false; }, 2000);
  });
}
</script>

<template>
  <div class="space-y-4">
    <!-- Warning banner -->
    <UAlert
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Write these words down on paper."
      description="You won't be able to view them again. Anyone with these words can recover your vault."
    />

    <!--
      Word list intentionally rendered as static text in a non-selectable grid.
      Screen recorders OCR static DOM text, but the individual-cell layout
      (no obvious word-N sequence) requires deliberate transcription.
      Physical write-down is the intended path — the checkbox enforces it.
    -->
    <div class="rounded-lg border border-default p-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-xs font-medium uppercase tracking-wider text-muted">Recovery phrase</span>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          aria-label="Copy all 24 words"
          @click="copyAll"
        >
          <span class="hidden sm:inline">{{ copied ? 'Copied' : 'Copy all' }}</span>
        </UButton>
      </div>

      <!-- 4-column grid of numbered words -->
      <div class="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <div
          v-for="(word, index) in mnemonic"
          :key="index"
          class="flex items-baseline gap-1.5 rounded-md bg-accented px-2 py-1.5"
        >
          <span class="tabular-nums text-xs text-muted w-5 text-right shrink-0">{{ index + 1 }}.</span>
          <span class="text-sm font-medium text-default break-all">{{ word }}</span>
        </div>
      </div>
    </div>

    <!-- Confirmation checkbox -->
    <UCheckbox
      v-model="confirmed"
      label="I have written down all 24 words in a safe place and stored them securely"
    />

    <!-- Finalize button -->
    <UButton
      block
      size="lg"
      color="primary"
      :loading="loading"
      :disabled="!confirmed || loading"
      @click="emit('confirm')"
    >
      I'm done — continue setup
    </UButton>
  </div>
</template>
