<script setup lang="ts">
// Generic confirmation modal (mockup confirm-modal): revoke / remove / disable flows.
// Model is named `open` so callers can pass a derived boolean (`:open` +
// `@update:open`) instead of being forced into a writable v-model.
const open = defineModel<boolean>('open', { required: true });

withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    loading?: boolean;
  }>(),
  { confirmLabel: 'Confirm', loading: false },
);

const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #content>
      <div class="p-5">
        <div class="mb-3 flex items-center gap-2.5">
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/15"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-4 text-rose-600 dark:text-rose-400" />
          </div>
          <h2 class="font-bold tracking-tight">{{ title }}</h2>
        </div>
        <p class="text-sm leading-relaxed text-toned">{{ message }}</p>
        <div class="mt-4 flex gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="lg"
            class="flex-1 justify-center"
            @click="open = false"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            size="lg"
            class="flex-1 justify-center"
            :loading="loading"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
