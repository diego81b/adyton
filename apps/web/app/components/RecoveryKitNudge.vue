<script setup lang="ts">
// Nudges any user without a recovery kit, independent of PAK enrollment — a
// zero-knowledge vault has no server-side password reset, so this is the only
// way to avoid a permanent lockout. Dismissal is local-only and does not
// re-prompt; it hides again automatically once a kit actually exists.
import { ref, computed, onMounted } from 'vue';
import { useStorage } from '@vueuse/core';
import { useAuthStore } from '~/stores/auth';

const auth = useAuthStore();

const loading = ref(true);
const hasKit = ref(true); // optimistic default — never flash the nudge on fetch failure
const dismissed = useStorage('adyton-recovery-kit-nudge-dismissed', false);

const show = computed(() => !loading.value && !hasKit.value && !dismissed.value);

onMounted(async () => {
  try {
    const result = await auth.apiFetch<{ hasKit: boolean }>('/auth/recovery/status');
    hasKit.value = result.hasKit;
  } catch {
    // Unknown state on fetch failure — stay quiet rather than nag incorrectly.
  } finally {
    loading.value = false;
  }
});

function dismiss() {
  dismissed.value = true;
}
</script>

<template>
  <div v-if="show" class="overflow-hidden rounded-lg border border-default">
    <SettingRow
      label="No recovery kit set up"
      helper="If you forget your password or lose every device, your vault can't be recovered."
      dot="bg-warning"
    >
      <template #action>
        <div class="flex w-full items-center gap-2 sm:w-auto">
          <UButton
            color="primary"
            variant="subtle"
            size="md"
            icon="i-lucide-key-round"
            to="/settings"
            class="flex-1 justify-center sm:flex-none"
          >
            <span class="hidden sm:inline">Set up</span>
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="md"
            icon="i-lucide-x"
            aria-label="Dismiss"
            @click="dismiss"
          />
        </div>
      </template>
    </SettingRow>
  </div>
</template>
