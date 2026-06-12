<script setup lang="ts">
import { ref } from 'vue';

// Password field with a lock leading icon and a show/hide eye toggle.
// Reused across login / register / unlock. v-model carries the value.

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
</script>

<template>
  <UInput
    v-model="model"
    :type="visible ? 'text' : 'password'"
    icon="i-lucide-lock"
    size="lg"
    class="w-full"
    :ui="{ base: 'font-mono' }"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :autofocus="autofocus"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
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
