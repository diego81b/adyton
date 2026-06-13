<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useVaultImport } from '~/composables/useVaultImport';
import PasswordInput from './PasswordInput.vue';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [count: number] }>();

const { importing, progress, wipeAndImport } = useVaultImport();

const fileContent = ref('');
const fileName = ref('');
const exportPassword = ref('');
const confirmText = ref('');
const errorMsg = ref('');
const done = ref(false);
const doneCount = ref(0);

const canImport = computed(
  () =>
    fileContent.value &&
    exportPassword.value.length > 0 &&
    confirmText.value.trim().toUpperCase() === 'WIPE' &&
    !importing.value,
);

watch(open, (isOpen) => {
  if (isOpen) {
    fileContent.value = '';
    fileName.value = '';
    exportPassword.value = '';
    confirmText.value = '';
    errorMsg.value = '';
    done.value = false;
    doneCount.value = 0;
  }
});

function onFilePick(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    fileContent.value = (e.target?.result as string) ?? '';
  };
  reader.readAsText(file);
}

async function onImport() {
  if (!canImport.value) return;
  errorMsg.value = '';
  try {
    const count = await wipeAndImport(fileContent.value, exportPassword.value);
    doneCount.value = count;
    done.value = true;
    emit('imported', count);
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    if (msg.includes('Unsupported export version')) {
      errorMsg.value = 'File format not supported. Export with a current Adyton version first.';
    } else if (msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('operation')) {
      errorMsg.value = 'Wrong export password or corrupted file.';
    } else {
      errorMsg.value = 'Import failed. Check the file and password, then try again.';
    }
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Import vault">
    <template #content>
      <div class="p-5 space-y-4">
        <div class="flex items-center gap-2.5">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
            <UIcon name="i-lucide-upload" class="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 class="font-bold tracking-tight">Import vault</h2>
        </div>

        <template v-if="!done">
          <!-- Destructive warning -->
          <div class="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300 leading-relaxed">
            <strong class="block text-rose-800 dark:text-rose-200 mb-0.5">This will permanently delete your current vault.</strong>
            All existing entries will be removed before the import runs.
            Make sure you have an export backup of your current vault first.
          </div>

          <!-- File picker -->
          <UFormField label="Export file" name="import-file">
            <label
              class="flex cursor-pointer items-center gap-3 rounded-xl border border-default bg-elevated px-4 py-3 transition hover:border-primary-500/50"
              :class="fileName ? 'border-brand-500/40' : ''"
            >
              <UIcon name="i-lucide-file-up" class="size-5 shrink-0 text-muted" />
              <span class="min-w-0 flex-1 truncate text-sm" :class="fileName ? 'text-highlighted' : 'text-muted'">
                {{ fileName || 'Choose .adyton file…' }}
              </span>
              <input
                type="file"
                accept=".adyton,.json"
                class="sr-only"
                @change="onFilePick"
              />
            </label>
          </UFormField>

          <!-- Export password -->
          <UFormField label="Export password" name="export-password">
            <PasswordInput
              v-model="exportPassword"
              class="w-full"
              placeholder="Password used when exporting"
              autocomplete="off"
            />
          </UFormField>

          <!-- Confirmation -->
          <UFormField name="confirm">
            <template #label>Type <span class="font-mono font-bold text-rose-700 dark:text-rose-300">WIPE</span> to confirm</template>
            <UInput
              v-model="confirmText"
              size="lg"
              class="w-full font-mono"
              placeholder="WIPE"
            />
          </UFormField>

          <!-- Progress bar (visible during import) -->
          <div v-if="importing" class="space-y-1.5">
            <div class="flex justify-between text-xs text-muted">
              <span>Importing…</span>
              <span>{{ progress.current }} / {{ progress.total }}</span>
            </div>
            <div class="h-1.5 w-full rounded-full bg-accented overflow-hidden">
              <div
                class="h-full rounded-full bg-brand-500 transition-all"
                :style="{ width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%' }"
              />
            </div>
          </div>

          <p v-if="errorMsg" class="text-xs text-error">{{ errorMsg }}</p>

          <div class="flex gap-2 pt-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="lg"
              class="flex-1 justify-center"
              :disabled="importing"
              @click="open = false"
            >
              Cancel
            </UButton>
            <UButton
              color="error"
              size="lg"
              class="flex-1 justify-center"
              :disabled="!canImport"
              :loading="importing"
              icon="i-lucide-upload"
              @click="onImport"
            >
              <span class="hidden sm:inline">Wipe and import</span>
              <span class="sm:hidden">Import</span>
            </UButton>
          </div>
        </template>

        <template v-else>
          <div class="rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 text-sm text-brand-700 dark:text-brand-300 leading-relaxed">
            <UIcon name="i-lucide-check-circle" class="inline size-4 mr-1 align-text-bottom" />
            Imported {{ doneCount }} {{ doneCount === 1 ? 'entry' : 'entries' }} successfully.
          </div>
          <UButton color="neutral" variant="subtle" size="lg" class="w-full justify-center" @click="open = false">
            Done
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
