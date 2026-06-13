<script setup lang="ts">
import { ref, computed } from 'vue';
import { VaultEntryType, type DecryptedEntry } from '@adyton/shared';
import { TYPE_META, ENVIRONMENT_META, VERSION_TAG_CLASS, entrySubtitle } from '../utils/entry-display';

const props = defineProps<{ entry: DecryptedEntry }>();
const emit = defineEmits<{ open: [id: string]; copy: [entry: DecryptedEntry] }>();

const meta = computed(() => TYPE_META[props.entry.type]);
const subtitle = computed(() => entrySubtitle(props.entry));
const env = computed(() => (props.entry.environment ? ENVIRONMENT_META[props.entry.environment] : null));
const monoLabel = computed(
  () => props.entry.type === VaultEntryType.SECRET,
);

// LOGIN (password) and SECRET (value) expose a one-tap copy. ENV_FILE is never
// copied whole to the clipboard (see nuxt.md §6.7 security note) — it opens detail.
const canCopy = computed(() =>
  [VaultEntryType.LOGIN, VaultEntryType.SECRET].includes(props.entry.type),
);

// Notes live in an explicit expansion below the row (same pattern on desktop and
// mobile): the resting card height stays uniform, and long notes never fight the
// copy button for horizontal space.
const notesOpen = ref(false);
</script>

<template>
  <div
    class="vault-card group relative overflow-hidden bg-elevated border border-default rounded-lg cursor-pointer hover:border-primary/40 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition"
    role="button"
    tabindex="0"
    @click="emit('open', entry.id)"
    @keydown.enter="emit('open', entry.id)"
  >
    <!-- Environment as a left color stripe (saves the old pill's space). An inner
         element, not the border itself, so the hover border highlight can't
         override it. Colors mirror the env dots used in filters/detail. -->
    <span
      v-if="env"
      class="absolute left-0 top-0 bottom-0 w-1"
      :class="env.dot"
      :title="env.label"
      :aria-label="env.label"
    />

    <!-- py-3 (not p-3.5): the vertical padding shrinks by the same 4px the row gap
         below adds, so the card height stays unchanged. -->
    <div class="px-3.5 py-3 flex items-center gap-3">
      <!-- Enterprise type indicator: one restrained surface tile for every type; the
           type is read from the per-type ICON + tooltip (text badge dropped earlier).
           The icon warms to the brand accent on hover/focus so the gold recurs without
           six saturated tiles. -->
      <div
        class="size-12 rounded-lg flex items-center justify-center shrink-0 border bg-muted border-default text-toned group-hover:text-primary group-focus-visible:text-primary transition-colors"
        :title="meta.label"
        :aria-label="meta.label"
      >
        <UIcon :name="meta.icon" class="size-6" />
      </div>

      <!-- Fixed 2-row structure (version+label / subtitle) so every card has the same
           resting height regardless of type or content — no accordion effect at rest. -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span :class="VERSION_TAG_CLASS" class="shrink-0">v{{ entry.secretVersion }}</span>
          <span class="font-semibold text-base truncate" :class="{ 'font-mono': monoLabel }">
            {{ entry.label }}
          </span>
        </div>
        <div class="mt-1 text-sm text-muted truncate min-h-[20px]" :class="{ 'font-mono': monoLabel }">
          {{ subtitle }}
        </div>
      </div>

      <!-- Action slots: ALWAYS two fixed columns (notes / copy) so the same action sits
           in the same place on every card — a spacer fills the slot when the action
           doesn't apply. Tinted tile-style buttons (bg+border like the type tiles) for
           visual harmony and a comfortable mobile tap target. -->
      <button
        v-if="entry.notes"
        type="button"
        data-testid="notes-toggle"
        class="size-10 rounded-lg border flex items-center justify-center shrink-0 transition"
        :class="
          notesOpen
            ? 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20'
            : 'bg-muted border-default text-toned hover:bg-primary/10 hover:text-primary hover:border-primary/40'
        "
        :aria-label="notesOpen ? `Hide notes for ${entry.label}` : `Show notes for ${entry.label}`"
        :aria-expanded="notesOpen"
        @click.stop="notesOpen = !notesOpen"
      >
        <UIcon name="i-lucide-sticky-note" class="size-5" />
      </button>
      <span v-else class="size-10 shrink-0" aria-hidden="true" />

      <!-- LOGIN/SECRET keep the one-tap copy; no chevron — the whole card opens detail. -->
      <button
        v-if="canCopy"
        type="button"
        data-testid="copy-action"
        class="size-10 rounded-lg border flex items-center justify-center shrink-0 transition bg-primary/10 border-primary/20 text-primary hover:bg-primary/20"
        :aria-label="`Copy from ${entry.label}`"
        @click.stop="emit('copy', entry)"
      >
        <UIcon name="i-lucide-copy" class="size-5" />
      </button>
      <span v-else class="size-10 shrink-0" aria-hidden="true" />
    </div>

    <!-- Explicit expansion: opens only on user action. @click.stop so reading or
         selecting the note text never navigates to the detail. -->
    <div
      v-if="notesOpen"
      data-testid="card-notes"
      class="px-3.5 pb-3.5 pt-3 border-t border-dashed border-default cursor-auto"
      @click.stop
    >
      <div class="text-[11px] font-mono uppercase tracking-wider text-dimmed mb-1">Notes</div>
      <p class="text-sm text-muted leading-relaxed whitespace-pre-wrap break-words">{{ entry.notes }}</p>
    </div>
  </div>
</template>
