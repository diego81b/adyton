<script setup lang="ts">
import { ref, computed, watchEffect, onMounted, useTemplateRef } from 'vue';
import { VaultEntryType, type DecryptedEntry } from '@adyton/shared';
import { useVaultStore } from '~/stores/vault';
import { useAppChrome } from '~/composables/useAppChrome';
import { useLockDeferral } from '~/composables/useLockDeferral';
import { detectEnvFormat, type EntryDraft } from '~/utils/vault-crypto';
import { TYPE_META, TILE_CLASS, ENVIRONMENT_META } from '~/utils/entry-display';

definePageMeta({ ssr: false, layout: 'vault', middleware: 'auth' });

const route = useRoute();
const router = useRouter();
const vault = useVaultStore();
const toast = useToast();
const { setChrome } = useAppChrome();

const id = computed(() => route.params.id as string);
const entry = computed<DecryptedEntry | undefined>(() => vault.byId(id.value));

const loading = ref(true);
const notFound = ref(false);
const editOpen = ref(false);
const historyOpen = ref(false);
const deleteOpen = ref(false);
const deleting = ref(false);

// In absolute lock mode, unsaved edits in the edit modal defer the auto-lock.
const entryDirty = ref(false);
useLockDeferral(entryDirty);
const envTable = useTemplateRef<{ downloadEnv: () => void }>('envTable');

const T = VaultEntryType;

onMounted(async () => {
  try {
    await vault.fetchEntry(id.value);
  } catch (err) {
    // 404 / not owned → not-found state; a locked vault throws too but middleware
    // would have redirected to /unlock before we reach here.
    notFound.value = true;
    toast.add({
      title: 'Entry unavailable',
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  } finally {
    loading.value = false;
  }
});

const typeMeta = computed(() => (entry.value ? TYPE_META[entry.value.type] : null));
const envMeta = computed(() =>
  entry.value?.environment ? ENVIRONMENT_META[entry.value.environment] : null,
);

// ENV_FILE blobs can hold dotenv or JSON (.NET appsettings) — the download button
// label must match the extension EnvFileTable.downloadEnv() will actually use.
const envDownloadLabel = computed(
  () => `Download .${detectEnvFormat(entry.value?.envContent ?? '') === 'json' ? 'json' : 'env'}`,
);

const metaLine = computed(() => {
  const e = entry.value;
  if (!e) return '';
  const added = `Added ${formatRelative(e.createdAt)}`;
  const modified = `last modified ${formatRelative(e.updatedAt)}`;
  return `${added} · ${modified}`;
});

watchEffect(() => {
  setChrome({ title: entry.value?.label || 'Entry', subtitle: typeMeta.value?.label });
});

function formatRelative(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return 'just now';
}

async function onSave(draft: EntryDraft) {
  try {
    await vault.updateEntry(id.value, draft);
    editOpen.value = false;
    toast.add({ title: 'Entry saved', color: 'success' });
  } catch (err) {
    toast.add({
      title: 'Save failed',
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  }
}

async function confirmDelete() {
  deleting.value = true;
  try {
    await vault.deleteEntry(id.value);
    toast.add({ title: 'Entry deleted', color: 'success' });
    await router.push('/vault');
  } catch (err) {
    toast.add({
      title: 'Delete failed',
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  } finally {
    deleting.value = false;
    deleteOpen.value = false;
  }
}
</script>

<template>
  <div>
    <!-- Back link (layout already provides the header) -->
    <NuxtLink
      to="/vault"
      class="inline-flex items-center gap-2 text-sm text-muted hover:text-default transition mb-5"
    >
      <UIcon name="i-lucide-arrow-left" class="size-4" />
      Back to vault
    </NuxtLink>

    <div v-if="loading" class="space-y-4">
      <USkeleton class="h-16 w-2/3 rounded-2xl" />
      <USkeleton class="h-48 rounded-2xl" />
    </div>

    <div v-else-if="notFound || !entry" class="py-16 text-center">
      <UIcon name="i-lucide-file-question" class="size-10 text-dimmed mx-auto mb-3" />
      <p class="text-sm text-muted">This entry does not exist or is not available.</p>
      <UButton class="mt-4" variant="soft" color="neutral" to="/vault" label="Back to vault" />
    </div>

    <template v-else>
      <!-- Title block -->
      <div class="flex items-start gap-4 mb-6">
        <div
          class="w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0"
          :class="typeMeta && TILE_CLASS[typeMeta.color]"
        >
          <UIcon v-if="typeMeta" :name="typeMeta.icon" class="size-6" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <UBadge v-if="typeMeta" :color="typeMeta.color" variant="soft" :label="typeMeta.label" />
            <UBadge
              v-if="envMeta"
              color="neutral"
              variant="soft"
              size="sm"
            >
              <span class="w-1.5 h-1.5 rounded-full mr-1" :class="envMeta.dot" />
              {{ envMeta.label }}
            </UBadge>
            <UBadge color="neutral" variant="outline" size="sm" :label="`v${entry.secretVersion}`" />
          </div>
          <h1 class="text-2xl font-bold tracking-tight mt-2 break-words">{{ entry.label }}</h1>
          <p class="text-xs text-dimmed mt-0.5">{{ metaLine }}</p>
        </div>
      </div>

      <!-- ENV_FILE: key/value table -->
      <EnvFileTable v-if="entry.type === T.ENV_FILE" ref="envTable" :entry="entry" />

      <!-- All other types: field card -->
      <div v-else class="bg-elevated/40 border border-default rounded-2xl divide-y divide-default">
        <!-- LOGIN -->
        <template v-if="entry.type === T.LOGIN">
          <DetailField v-if="entry.url" label="Site URL" :value="entry.url" :link="entry.url" />
          <DetailField v-if="entry.username" label="Username" :value="entry.username" :mono="false" />
          <DetailField v-if="entry.password" label="Password" :value="entry.password" revealable />
          <EntryTotp v-if="entry.totpSecret" :secret="entry.totpSecret" />
        </template>

        <!-- SECRET -->
        <template v-else-if="entry.type === T.SECRET">
          <DetailField v-if="entry.secretKey" label="Key" :value="entry.secretKey" />
          <DetailField v-if="entry.secretValue" label="Value" :value="entry.secretValue" revealable />
          <DetailField
            v-if="entry.secretDescription"
            label="Description"
            :value="entry.secretDescription"
            :mono="false"
            :copyable="false"
          />
        </template>

        <!-- CREDIT_CARD -->
        <template v-else-if="entry.type === T.CREDIT_CARD">
          <DetailField
            v-if="entry.cardholderName"
            label="Cardholder"
            :value="entry.cardholderName"
            :mono="false"
          />
          <DetailField v-if="entry.cardNumber" label="Card number" :value="entry.cardNumber" revealable />
          <DetailField v-if="entry.cardExpiry" label="Expiry" :value="entry.cardExpiry" />
          <DetailField v-if="entry.cardCvv" label="CVV" :value="entry.cardCvv" revealable />
        </template>

        <!-- IDENTITY -->
        <template v-else-if="entry.type === T.IDENTITY">
          <DetailField v-if="entry.firstName" label="First name" :value="entry.firstName" :mono="false" />
          <DetailField v-if="entry.lastName" label="Last name" :value="entry.lastName" :mono="false" />
          <DetailField v-if="entry.email" label="Email" :value="entry.email" :mono="false" />
          <DetailField v-if="entry.phone" label="Phone" :value="entry.phone" :mono="false" />
        </template>

        <!-- Notes (shared across types that carry them) -->
        <div v-if="entry.notes" class="p-4">
          <div class="text-[10px] font-mono uppercase tracking-wider text-dimmed mb-1.5">Notes</div>
          <p class="text-sm text-default leading-relaxed whitespace-pre-wrap break-words">{{ entry.notes }}</p>
        </div>
      </div>

      <!-- Action bar. Icon-only on mobile (labels appear from sm up) so all actions fit
           one row; labels keep them clear on larger screens. -->
      <div class="flex gap-2 mt-5">
        <UButton
          v-if="entry.type === T.ENV_FILE"
          class="flex-1 accent-glow text-white justify-center"
          icon="i-lucide-download"
          :aria-label="envDownloadLabel"
          @click="envTable?.downloadEnv()"
        >
          <span class="hidden sm:inline">{{ envDownloadLabel }}</span>
        </UButton>
        <UButton
          class="flex-1 justify-center"
          color="neutral"
          variant="soft"
          icon="i-lucide-pencil"
          aria-label="Edit"
          @click="editOpen = true"
        >
          <span class="hidden sm:inline">Edit</span>
        </UButton>
        <UButton
          class="flex-1 justify-center"
          color="neutral"
          variant="soft"
          icon="i-lucide-history"
          aria-label="History"
          @click="historyOpen = true"
        >
          <span class="hidden sm:inline">History</span>
        </UButton>
        <UButton
          class="flex-1 justify-center"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          aria-label="Delete"
          @click="deleteOpen = true"
        >
          <span class="hidden sm:inline">Delete</span>
        </UButton>
      </div>

      <!-- Encryption badge -->
      <div class="mt-6 flex items-center justify-center gap-2 text-[11px] text-dimmed">
        <UIcon name="i-lucide-shield-check" class="size-3" />
        Encrypted locally — server sees only ciphertext
      </div>

      <!-- Edit modal -->
      <VaultEntryModal v-model="editOpen" v-model:dirty="entryDirty" :entry="entry" @save="onSave" />

      <!-- Version history -->
      <VersionHistory v-model="historyOpen" :entry-id="entry.id" />

      <!-- Delete confirm -->
      <UModal v-model:open="deleteOpen" title="Delete entry?">
        <template #body>
          <p class="text-sm text-muted">
            <span class="text-default font-medium">{{ entry.label }}</span> and its full version
            history will be permanently deleted. This cannot be undone.
          </p>
        </template>
        <template #footer>
          <div class="flex gap-2 justify-end w-full">
            <UButton color="neutral" variant="soft" label="Cancel" @click="deleteOpen = false" />
            <UButton color="error" label="Delete" :loading="deleting" @click="confirmDelete" />
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
