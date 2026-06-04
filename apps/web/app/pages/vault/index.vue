<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from 'vue';
import { useInfiniteScroll } from '@vueuse/core';
import { VaultEntryType, type DecryptedEntry, type EnvironmentTag } from '@adyton/shared';
import { useVaultStore } from '~/stores/vault';
import { useAppChrome } from '~/composables/useAppChrome';
import { useLockDeferral } from '~/composables/useLockDeferral';
import { useSecureClipboard } from '~/composables/useSecureClipboard';
import type { EntryDraft } from '~/utils/vault-crypto';
import { TYPE_FILTERS, ENVIRONMENT_META, searchHaystack } from '~/utils/entry-display';

definePageMeta({ ssr: false, layout: 'vault', middleware: 'auth' });

const vault = useVaultStore();
const router = useRouter();
const toast = useToast();
const { setChrome } = useAppChrome();
const { copy } = useSecureClipboard();

const search = ref('');
const typeFilter = ref<VaultEntryType | 'all'>('all');
const envFilter = ref<EnvironmentTag | 'all'>('all');
const addOpen = ref(false);
const filtersOpen = ref(false);

// In absolute lock mode, unsaved edits in the add modal defer the auto-lock.
const entryDirty = ref(false);
useLockDeferral(entryDirty);

const activeFilterCount = computed(
  () => (typeFilter.value !== 'all' ? 1 : 0) + (envFilter.value !== 'all' ? 1 : 0),
);

async function onAdd(draft: EntryDraft) {
  try {
    const created = await vault.createEntry(draft);
    addOpen.value = false;
    toast.add({ title: 'Entry created', color: 'success' });
    router.push(`/vault/${created.id}`);
  } catch (err) {
    toast.add({
      title: 'Create failed',
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  }
}

onMounted(() => {
  // Load all pages so client-side search/filter cover the whole vault (the server
  // cannot search ciphertext, so partial loading would silently miss entries).
  if (!vault.loaded) vault.fetchAll().catch(reportError);
});

// The window is the scroll container (layout <main> flows naturally). Bind here, not
// to a page element, or the callback never fires. A "Load more" button below is the
// explicit fallback.
useInfiniteScroll(
  () => window,
  () => {
    if (vault.hasMore && !vault.loading) vault.loadMore().catch(reportError);
  },
  { distance: 300, canLoadMore: () => vault.hasMore && !vault.loading },
);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return vault.entries.filter((e) => {
    if (typeFilter.value !== 'all' && e.type !== typeFilter.value) return false;
    if (envFilter.value !== 'all' && e.environment !== envFilter.value) return false;
    if (q && !searchHaystack(e).includes(q)) return false;
    return true;
  });
});

const counts = computed(() => {
  const map: Record<string, number> = { all: vault.entries.length };
  for (const f of TYPE_FILTERS) map[f.type] = 0;
  for (const e of vault.entries) map[e.type] = (map[e.type] ?? 0) + 1;
  return map;
});

const envCount = computed(
  () => new Set(vault.entries.map((e) => e.environment).filter(Boolean)).size,
);

const envOptions = computed(() => [
  { value: 'all' as const, label: 'All environments' },
  ...(Object.keys(ENVIRONMENT_META) as EnvironmentTag[]).map((tag) => ({
    value: tag,
    label: ENVIRONMENT_META[tag].label,
  })),
]);

watchEffect(() => {
  setChrome({
    title: 'All Items',
    subtitle: `${vault.entries.length} ${vault.entries.length === 1 ? 'entry' : 'entries'} · ${envCount.value} environments`,
  });
});

function reportError(err: unknown) {
  toast.add({
    title: 'Could not load vault',
    description: err instanceof Error ? err.message : String(err),
    color: 'error',
  });
}

function openEntry(id: string) {
  router.push(`/vault/${id}`);
}

async function copyEntry(entry: DecryptedEntry) {
  const value = entry.type === VaultEntryType.LOGIN ? entry.password : entry.secretValue;
  if (!value) {
    toast.add({ title: 'Nothing to copy', color: 'warning' });
    return;
  }
  const ok = await copy(value);
  toast.add(
    ok
      ? { title: 'Copied', description: 'Clears from clipboard in 30s', color: 'success' }
      : { title: 'Copy failed', color: 'error' },
  );
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-4">
    <!-- Search + Filters + Add. Search stays inline (primary action); type + environment
         filters live in a slideover to keep the list clean. -->
    <div class="flex gap-2.5">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search vault…"
        size="lg"
        class="flex-1"
        :ui="{ root: 'w-full' }"
      />
      <UChip :text="activeFilterCount" :show="activeFilterCount > 0" color="primary" size="2xl">
        <UButton
          size="lg"
          color="neutral"
          variant="soft"
          icon="i-lucide-list-filter"
          aria-label="Filters"
          @click="filtersOpen = true"
        >
          <span class="hidden sm:inline">Filters</span>
        </UButton>
      </UChip>
      <UButton
        size="lg"
        icon="i-lucide-plus"
        class="accent-glow text-white"
        aria-label="Add entry"
        @click="addOpen = true"
      >
        <span class="hidden sm:inline">Add</span>
      </UButton>
    </div>

    <VaultFilters
      v-model:open="filtersOpen"
      v-model:type="typeFilter"
      v-model:environment="envFilter"
      :counts="counts"
      :env-options="envOptions"
    />

    <!-- Entries -->
    <div v-if="vault.loading && !vault.entries.length" class="space-y-2.5">
      <USkeleton v-for="i in 5" :key="i" class="h-[68px] rounded-xl" />
    </div>

    <div v-else-if="filtered.length" class="space-y-2.5">
      <VaultEntryCard
        v-for="entry in filtered"
        :key="entry.id"
        :entry="entry"
        @open="openEntry"
        @copy="copyEntry"
      />
      <div v-if="vault.hasMore" class="py-3 text-center">
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          :loading="vault.loading"
          :label="vault.loading ? 'Loading…' : 'Load more'"
          @click="vault.loadMore().catch(reportError)"
        />
      </div>
    </div>

    <div v-else class="py-16 text-center">
      <UIcon name="i-lucide-vault" class="size-10 text-dimmed mx-auto mb-3" />
      <p class="text-sm text-muted">
        {{ vault.entries.length ? 'No entries match your filters.' : 'Your vault is empty.' }}
      </p>
    </div>

    <VaultEntryModal v-model="addOpen" v-model:dirty="entryDirty" @save="onAdd" />
  </div>
</template>
