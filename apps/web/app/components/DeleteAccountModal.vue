<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAuthStore } from '~/stores/auth';
import PasswordInput from './PasswordInput.vue';

// Account deletion — master password confirmation, then DELETE /auth/account.
// The server cascades: vault entries, versions, sessions, devices all go with the user.
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ deleted: [] }>();

const auth = useAuthStore();

const password = ref('');
const confirmText = ref('');
const deleting = ref(false);
const errorMsg = ref('');

const canDelete = computed(
  () => password.value.length > 0 && confirmText.value.trim().toUpperCase() === 'DELETE',
);

watch(open, (isOpen) => {
  if (isOpen) {
    password.value = '';
    confirmText.value = '';
    errorMsg.value = '';
  }
});

async function onDelete() {
  if (!canDelete.value || deleting.value) return;
  deleting.value = true;
  errorMsg.value = '';
  try {
    await auth.apiFetch('/auth/account', {
      method: 'DELETE',
      body: { password: password.value },
    });
    open.value = false;
    emit('deleted');
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { status?: number })?.status;
    errorMsg.value =
      status === 401
        ? 'Wrong master password.'
        : 'Deletion failed. Please try again.';
  } finally {
    deleting.value = false;
    password.value = '';
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Delete account">
    <template #content>
      <div class="p-5">
        <div class="mb-3 flex items-center gap-2.5">
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/15"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-4 text-rose-400" />
          </div>
          <h2 class="font-bold tracking-tight">Delete account</h2>
        </div>

        <p class="text-sm leading-relaxed text-toned">
          This permanently deletes your account and
          <strong class="text-rose-300">every secret in your vault</strong>. There is no
          recovery — the data is encrypted with a key only you hold.
        </p>

        <div class="mt-4 space-y-3.5">
          <UFormField label="Master password" name="password">
            <PasswordInput
              v-model="password"
              class="w-full"
              placeholder="••••••••••••"
              autocomplete="current-password"
            />
          </UFormField>
          <UFormField name="confirm">
            <template #label>Type <span class="font-mono font-bold">DELETE</span> to confirm</template>
            <UInput v-model="confirmText" size="lg" class="w-full font-mono" placeholder="DELETE" />
          </UFormField>
          <p v-if="errorMsg" class="text-xs text-error">{{ errorMsg }}</p>
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
            color="error"
            size="lg"
            class="flex-1 justify-center"
            :disabled="!canDelete"
            :loading="deleting"
            @click="onDelete"
          >
            Delete forever
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
