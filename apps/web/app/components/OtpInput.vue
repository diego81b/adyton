<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

// Segmented OTP input: `length` square boxes on a single row that fill as the user
// types. A single transparent <input> is overlaid across the whole row to capture
// typing — this preserves native paste, mobile OS one-time-code autofill, a single
// focus target, and the caret stays hidden so only the derived boxes are visible.
const props = withDefaults(
  defineProps<{
    length?: number;
    disabled?: boolean;
    autofocus?: boolean;
    invalid?: boolean;
    name?: string;
    ariaLabel?: string;
  }>(),
  { length: 6, disabled: false, autofocus: false, invalid: false },
);

const model = defineModel<string>({ default: '' });

const emit = defineEmits<{
  complete: [code: string];
}>();

const inputEl = ref<HTMLInputElement | null>(null);
const focused = ref(false);

// Visible boxes are derived display only; the value is always sanitised to digits.
const boxes = computed(() => Array.from({ length: props.length }, (_, i) => model.value[i] ?? ''));

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  const next = raw.replace(/\D/g, '').slice(0, props.length);
  model.value = next;
  // Keep the real input's value in sync after filtering (e.g. when a letter is typed
  // it is dropped, so the DOM value must not drift from the model).
  if (inputEl.value && inputEl.value.value !== next) inputEl.value.value = next;
  if (next.length === props.length) emit('complete', next);
}

function focus() {
  inputEl.value?.focus();
}

onMounted(() => {
  if (props.autofocus) focus();
});
</script>

<template>
  <div class="relative w-full" @click="focus">
    <div class="flex w-full gap-2 sm:gap-2.5">
      <div
        v-for="(digit, i) in boxes"
        :key="i"
        class="flex h-13 min-w-0 flex-1 select-none items-center justify-center rounded-lg border font-mono text-2xl font-semibold transition sm:h-14"
        :class="[
          invalid
            ? 'border-error/60'
            : digit
              ? 'border-primary/60 bg-primary/5 text-highlighted'
              : 'border-default bg-muted text-highlighted',
          focused && i === model.length && !invalid ? 'border-primary ring-2 ring-primary' : '',
        ]"
      >
        {{ digit }}
      </div>
    </div>

    <input
      ref="inputEl"
      :value="model"
      :name="name"
      :maxlength="length"
      :disabled="disabled"
      :aria-label="ariaLabel"
      inputmode="numeric"
      autocomplete="one-time-code"
      spellcheck="false"
      style="touch-action: manipulation"
      class="absolute inset-0 h-full w-full cursor-default bg-transparent text-transparent caret-transparent outline-none"
      @input="onInput"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>
