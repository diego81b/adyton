<script setup lang="ts">
import { ref } from 'vue';

// Password field with a lock leading icon and a show/hide eye toggle.
// Reused across login / register / unlock. v-model carries the value.
import { computed } from 'vue';

const model = defineModel<string>({ required: true });
withDefaults(
  defineProps<{
    placeholder?: string;
    autocomplete?: string;
    autofocus?: boolean;
  }>(),
  { autocomplete: 'off' },
);

const visible = ref(false);

// Always type="text" — masking is done with CSS (text-security-disc), NOT type=password,
// so Chromium/Edge attach no password UI (no saved-password autofill, no "suggest strong
// password" dropdown, no native reveal eye). The eye toggle just flips the mask class.
const baseClass = computed(() => (visible.value ? 'font-mono' : 'font-mono text-security-disc'));
</script>

<template>
  <UInput
    v-model="model"
    type="text"
    icon="i-lucide-lock"
    size="lg"
    class="w-full"
    :ui="{ base: baseClass }"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :autofocus="autofocus"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    data-1p-ignore
    data-lpignore="true"
    data-bwignore
    data-form-type="other"
    required
  >
    <template #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        :padded="false"
        tabindex="-1"
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="visible ? 'Hide password' : 'Show password'"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
