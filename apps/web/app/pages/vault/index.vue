<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from 'vue';
import { useInfiniteScroll } from '@vueuse/core';
import { VaultEntryType, type DecryptedEntry, type EnvironmentTag } from '@adyton/shared';
import { useVaultStore } from '~/stores/vault';
import { useAppChrome } from '~/composables/useAppChrome';
import { useSecureClipboard } from '~/composables/useSecureClipboard';
import { TYPE_FILTERS, ENVIRONMENT_META, searchHaystack, chipClass } from '~/utils/entry-display';

definePageMeta({ ssr: false, layout: 'vault', middleware: 'auth' });

const vault = useVaultStore();
const router = useRouter();
const toast = useToast();
const { setChrome } = useAppChrome();
const { copy } = useSecureClipboard();

const search = ref('');
const typeFilter = ref<VaultEntryType | 'all'>('all');
const envFilter = ref<EnvironmentTag | 'all'>('all');

// DEV-ONLY: seed sample entries so the list is testable before the Step 2 create modal.
// import.meta.dev is false in production builds, so this branch tree-shakes away.
const isDev = import.meta.dev;
const seeding = ref(false);
async function seedSampleData() {
  const { SAMPLE_DRAFTS } = await import('~/utils/dev-seed');
  seeding.value = true;
  try {
    for (const draft of SAMPLE_DRAFTS) await vault.createEntry(draft);
    toast.add({ title: `Seeded ${SAMPLE_DRAFTS.length} sample entries`, color: 'success' });
  } catch (err) {
    reportError(err);
  } finally {
    seeding.value = false;
  }
}

onMounted(() => {
  if (!vault.loaded) vault.fetchEntries(true).catch(reportError);
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
  <div class="space-y-4">
    <!-- Search + Add -->
    <div class="flex gap-2.5">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search vault…"
        size="lg"
        class="flex-1"
        :ui="{ root: 'w-full' }"
      />
      <UButton
        v-if="isDev"
        size="lg"
        color="neutral"
        variant="soft"
        icon="i-lucide-database"
        label="Seed"
        :loading="seeding"
        title="DEV only: create sample entries"
        @click="seedSampleData"
      />
      <UButton
        size="lg"
        icon="i-lucide-plus"
        class="accent-glow text-white"
        label="Add"
        disabled
        title="Add entry — coming in step 2"
      />
    </div>

    <!-- Type filter chips (per-type colors, mockup screen-vault) -->
    <div class="flex gap-2 overflow-x-auto scrollbar-none -mx-4 lg:mx-0 px-4 lg:px-0">
      <button
        type="button"
        class="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition"
        :class="chipClass('all', typeFilter === 'all')"
        @click="typeFilter = 'all'"
      >
        All <span class="opacity-75 ml-1">{{ counts.all }}</span>
      </button>
      <button
        v-for="f in TYPE_FILTERS"
        :key="f.type"
        type="button"
        class="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition"
        :class="chipClass(f.type, typeFilter === f.type)"
        @click="typeFilter = f.type"
      >
        {{ f.label }} <span class="opacity-75 ml-1">{{ counts[f.type] }}</span>
      </button>
    </div>

    <!-- Environment filter -->
    <div class="flex items-center gap-2 text-xs">
      <span class="text-muted font-medium">Environment:</span>
      <USelect
        v-model="envFilter"
        :items="envOptions"
        value-key="value"
        size="sm"
        class="w-44"
      />
    </div>

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
  </div>
</template>
