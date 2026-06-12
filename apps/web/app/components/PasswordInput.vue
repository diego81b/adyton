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
    /** Vault secret mode: keep type="text" and mask via CSS (text-security-disc) so
        autofill frameworks never see a password field — no "save to Google" prompt.
        Auth fields (login/register/unlock) must NOT set this: they want real
        type="password" so the browser password manager keeps working. */
    concealed?: boolean;
    /** Auth fields are mandatory; vault secret fields are optional (the entry label
        is the only gate) — pass false there so native constraint validation and
        screen readers don't claim otherwise. */
    required?: boolean;
  }>(),
  { autocomplete: 'off', required: true },
);

const visible = ref(false);
</script>

<template>
  <UInput
    v-model="model"
    :type="visible || concealed ? 'text' : 'password'"
    icon="i-lucide-lock"
    size="lg"
    class="w-full"
    :ui="{ base: concealed && !visible ? 'font-mono text-security-disc' : 'font-mono' }"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :autofocus="autofocus"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    :required="required"
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
