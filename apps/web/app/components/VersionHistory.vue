<script setup lang="ts">
import { ref, watch } from 'vue';
import type { DecryptedEntry } from '@adyton/shared';
import { VERSION_TAG_CLASS } from '~/utils/entry-display';
import { useVaultStore } from '~/stores/vault';
import type { DecryptedVersion } from '~/utils/vault-crypto';

// The root is a <Transition> (renderless), so let attrs (e.g. layout margin from the
// page) land on the inner <section> instead of failing to inherit.
defineOptions({ inheritAttrs: false });

// `version` is the entry's current secretVersion: it bumps on every edit/restore, so
// watching it reloads history exactly when the vault changes — never on toggle.
const props = defineProps<{ entryId: string; version: number }>();
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
    // entry.secretVersion bumped → the `version` watcher below reloads the list, so the
    // restored state shows immediately without re-opening the section.
    emit('restored', entry);
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

// Load once on mount and whenever the entry or its version changes — NOT on open, so
// expanding the section is instant (no fetch/decrypt round-trip on every toggle).
watch(
  () => [props.entryId, props.version],
  () => load(),
  { immediate: true },
);
</script>

<template>
  <!-- Inline collapsible section (not a modal): expands below the entry detail,
       toggled by the page's History button. Hairline-divided container per
       design-system §8 — same grammar as the detail field card. -->
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0 -translate-y-1"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="opacity-0 -translate-y-1"
  >
    <section v-if="open" v-bind="$attrs" class="rounded-lg border border-default bg-elevated divide-y divide-default">
      <div class="flex items-center gap-2 px-4 py-2.5">
        <span class="text-[11px] font-mono uppercase tracking-wider text-dimmed">Version history</span>
        <span v-if="!loading && versions.length" class="text-[11px] text-dimmed tabular-nums">
          · {{ versions.length }}
        </span>
      </div>

      <div v-if="loading" class="space-y-2 p-4">
        <USkeleton v-for="i in 3" :key="i" class="h-12 rounded-md" />
      </div>

      <template v-else-if="versions.length">
        <!-- List row: text block left, Restore right and vertically centered against the
             whole block (vN + date line, plus an optional change-note line below). -->
        <div v-for="v in versions" :key="v.id" class="flex items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span :class="VERSION_TAG_CLASS" class="shrink-0 tabular-nums">v{{ v.version }}</span>
              <span class="min-w-0 truncate text-sm text-muted tabular-nums">
                {{ v.createdAt.toLocaleString() }}
              </span>
            </div>
            <p v-if="v.changeNote" class="mt-1 text-sm text-muted leading-relaxed break-words">
              {{ v.changeNote }}
            </p>
          </div>
          <UButton
            color="neutral"
            variant="subtle"
            size="sm"
            icon="i-lucide-history"
            class="shrink-0"
            :aria-label="`Restore version ${v.version}`"
            :loading="restoringId === v.id"
            @click="restore(v.id)"
          >
            <span class="hidden sm:inline">Restore</span>
          </UButton>
        </div>
      </template>

      <div v-else class="px-4 py-8 text-center text-sm text-muted">No previous versions.</div>
    </section>
  </Transition>
</template>
