import { ref } from 'vue';
import { importVault, type VaultExportEntry } from '@adyton/shared';
import { useVaultStore } from '~/stores/vault';
import type { EntryDraft } from '~/utils/vault-crypto';

function toEntryDraft(e: VaultExportEntry): EntryDraft {
  return e as unknown as EntryDraft;
}

export interface ImportProgress {
  current: number;
  total: number;
}

export function useVaultImport() {
  const importing = ref(false);
  const progress = ref<ImportProgress>({ current: 0, total: 0 });

  async function wipeAndImport(fileContent: string, exportPassword: string): Promise<number> {
    importing.value = true;
    progress.value = { current: 0, total: 0 };
    const vault = useVaultStore();
    try {
      const file = JSON.parse(fileContent) as Record<string, unknown>;
      const exportedEntries = await importVault(file as never, exportPassword);

      // Wipe all existing entries first (single DELETE /vault request).
      await vault.wipeAll();

      // Re-import: assign fresh UUIDs and encrypt under current vault key + userId.
      progress.value.total = exportedEntries.length;
      for (const exportEntry of exportedEntries) {
        await vault.createEntry(toEntryDraft(exportEntry));
        progress.value.current++;
      }

      return exportedEntries.length;
    } finally {
      importing.value = false;
    }
  }

  return { importing, progress, wipeAndImport };
}
