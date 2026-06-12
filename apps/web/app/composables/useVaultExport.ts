import { ref } from 'vue';
import { exportVault, type VaultExportEntry } from '@adyton/shared';
import type { DecryptedEntry } from '@adyton/shared';
import { useVaultStore } from '~/stores/vault';

function toExportEntry(entry: DecryptedEntry): VaultExportEntry {
  // Omit structural fields that are either server-managed (id, timestamps,
  // secretVersion) or derived client-side and never persisted (envParsed).
  const { id: _id, createdAt: _c, updatedAt: _u, secretVersion: _v, envParsed: _p, ...rest } = entry;
  return rest as VaultExportEntry;
}

export function useVaultExport() {
  const exporting = ref(false);
  const vault = useVaultStore();

  async function downloadExport(password: string): Promise<void> {
    exporting.value = true;
    try {
      const exportEntries = vault.entries.map(toExportEntry);
      const file = await exportVault(exportEntries, password);
      const json = JSON.stringify(file, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `adyton-export-${date}.adyton`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      exporting.value = false;
    }
  }

  return { exporting, downloadExport };
}
