<script setup lang="ts">
import { ref, watch } from 'vue';
import RecoveryCodesList from './RecoveryCodesList.vue';

// Thin wrapper shown after regenerating recovery codes. Same one-time semantics
// as the enrollment step: acknowledgment gates the only close action, and the
// modal cannot be dismissed by esc/outside-click or the X.
const open = defineModel<boolean>('open', { required: true });
defineProps<{ codes: string[] }>();

const acknowledged = ref(false);

watch(open, (isOpen) => {
  if (isOpen) acknowledged.value = false;
});

function finish() {
  if (!acknowledged.value) return;
  open.value = false;
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="New recovery codes"
    :dismissible="false"
    :close="false"
  >
    <template #content>
      <div class="p-5">
        <div class="mb-3 flex items-center gap-2.5">
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/15"
          >
            <UIcon name="i-lucide-key-round" class="size-4 text-brand-400" />
          </div>
          <h2 class="font-bold tracking-tight">New recovery codes</h2>
        </div>

        <p class="text-sm leading-relaxed text-toned">
          Your previous codes no longer work. Save these new ones — they are
          <strong class="text-highlighted">shown only now</strong>.
        </p>

        <div class="mt-4">
          <RecoveryCodesList :codes="codes" />
        </div>

        <label class="mt-4 flex items-start gap-2.5">
          <UCheckbox v-model="acknowledged" />
          <span class="text-xs leading-relaxed text-toned">
            I saved these codes — they are shown only once
          </span>
        </label>

        <UButton
          color="primary"
          size="lg"
          block
          class="mt-5"
          :disabled="!acknowledged"
          @click="finish"
        >
          Done
        </UButton>
      </div>
    </template>
  </UModal>
</template>
