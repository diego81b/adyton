<script setup lang="ts">
import { ref, watch } from 'vue';
import PasswordInput from './PasswordInput.vue';

// Reusable controlled password-confirmation modal. It is intentionally dumb:
// it emits `confirm(password)` and the caller owns the request, mapping the
// outcome back to the `loading` / `error` props. This lets the same modal back
// both the 2FA disable (danger) and recovery-code regeneration flows.
const open = defineModel<boolean>('open', { required: true });

withDefaults(
  defineProps<{
    title: string;
    confirmLabel?: string;
    danger?: boolean;
    loading?: boolean;
    error?: string | null;
  }>(),
  { confirmLabel: 'Confirm', danger: false, loading: false, error: null },
);

const emit = defineEmits<{ confirm: [password: string] }>();

const password = ref('');

watch(open, (isOpen) => {
  if (isOpen) password.value = '';
});

function onConfirm() {
  if (password.value.length === 0) return;
  emit('confirm', password.value);
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #content>
      <div class="p-5">
        <div class="mb-3 flex items-center gap-2.5">
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-lg border"
            :class="danger
              ? 'border-rose-500/30 bg-rose-500/15'
              : 'border-default bg-accented'"
          >
            <UIcon
              :name="danger ? 'i-lucide-triangle-alert' : 'i-lucide-lock'"
              class="size-4"
              :class="danger ? 'text-rose-400' : 'text-muted'"
            />
          </div>
          <h2 class="font-bold tracking-tight">{{ title }}</h2>
        </div>

        <p class="text-sm leading-relaxed text-toned">
          Confirm with your master password to continue.
        </p>

        <div class="mt-4 space-y-3.5">
          <UFormField label="Master password" name="password">
            <PasswordInput
              v-model="password"
              class="w-full"
              placeholder="••••••••••••"
              autocomplete="current-password"
              @keydown.enter="onConfirm"
            />
          </UFormField>
          <p v-if="error" class="text-xs text-error">{{ error }}</p>
        </div>

        <div class="mt-4 flex gap-2">
          <UButton
            color="neutral"
            variant="soft"
            size="lg"
            class="flex-1 justify-center"
            @click="open = false"
          >
            Cancel
          </UButton>
          <UButton
            :color="danger ? 'error' : 'primary'"
            size="lg"
            class="flex-1 justify-center"
            :disabled="password.length === 0"
            :loading="loading"
            @click="onConfirm"
          >
            {{ confirmLabel }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
