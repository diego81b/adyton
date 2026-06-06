<script setup lang="ts">
import { ref, watch } from 'vue';
import type { DecryptedEntry } from '@adyton/shared';
import { useVaultStore } from '~/stores/vault';
import type { DecryptedVersion } from '~/utils/vault-crypto';

const props = defineProps<{ entryId: string }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ restored: [entry: DecryptedEntry] }>();

const vault = useVaultStore();
const toast = useToast();

const versions = ref<DecryptedVersion[]>([]);
const loading = ref(false);
const restoringId = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    versions.value = await vault.listVersions(props.entryId);
  } catch (err) {
    toast.add({
      title: 'Could not load history',
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  } finally {
    loading.value = false;
  }
}

async function restore(versionId: string) {
  restoringId.value = versionId;
  try {
    const entry = await vault.restoreVersion(props.entryId, versionId);
    toast.add({ title: 'Version restored', color: 'success' });
    emit('restored', entry);
    open.value = false;
  } catch (err) {
    toast.add({
      title: 'Restore failed',
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  } finally {
    restoringId.value = null;
  }
}

watch(open, (v) => {
  if (v) load();
});
</script>

<template>
  <UModal v-model:open="open" title="Version history">
    <template #body>
      <div v-if="loading" class="space-y-2">
        <USkeleton v-for="i in 3" :key="i" class="h-14 rounded-lg" />
      </div>

      <div v-else-if="versions.length" class="space-y-2">
        <div
          v-for="v in versions"
          :key="v.id"
          class="flex items-center gap-3 p-3 rounded-lg bg-elevated/40 border border-default"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-semibold text-primary">v{{ v.version }}</span>
              <span class="text-[11px] text-dimmed">{{ v.createdAt.toLocaleString() }}</span>
            </div>
            <p v-if="v.changeNote" class="text-xs text-muted truncate mt-0.5">{{ v.changeNote }}</p>
            <p class="text-xs text-muted truncate mt-0.5">{{ v.entry.label }}</p>
          </div>
          <UButton
            color="neutral"
            variant="soft"
            size="xs"
            label="Restore"
            icon="i-lucide-history"
            :loading="restoringId === v.id"
            @click="restore(v.id)"
          />
        </div>
      </div>

      <div v-else class="py-8 text-center text-sm text-muted">No previous versions.</div>
    </template>
  </UModal>
</template>
