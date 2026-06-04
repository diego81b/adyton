<script setup lang="ts">
import { ref, computed } from 'vue';
import { VaultEntryType, type DecryptedEntry } from '@adyton/shared';
import { TYPE_META, TILE_CLASS, ENVIRONMENT_META, entrySubtitle } from '../utils/entry-display';

const props = defineProps<{ entry: DecryptedEntry }>();
const emit = defineEmits<{ open: [id: string]; copy: [entry: DecryptedEntry] }>();

const meta = computed(() => TYPE_META[props.entry.type]);
const tileClass = computed(() => TILE_CLASS[props.entry.type]);
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
    class="vault-card bg-elevated border border-default rounded-xl cursor-pointer hover:border-primary/40 transition"
    role="button"
    tabindex="0"
    @click="emit('open', entry.id)"
    @keydown.enter="emit('open', entry.id)"
  >
    <div class="p-3.5 flex items-center gap-3">
      <!-- The tile is the type indicator (tooltip replaces the old redundant text badge). -->
      <div
        class="size-10 rounded-lg flex items-center justify-center shrink-0 border"
        :class="tileClass"
        :title="meta.label"
        :aria-label="meta.label"
      >
        <UIcon :name="meta.icon" class="size-5" />
      </div>

      <!-- Fixed 3-row structure (badges / label / subtitle) so every card has the same
           resting height regardless of type or content — no accordion effect at rest. -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 mb-0.5 h-[18px]">
          <UBadge color="neutral" variant="soft" size="sm">v{{ entry.secretVersion }}</UBadge>
          <span
            v-if="env"
            class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-elevated text-muted border border-default"
          >
            <span class="size-1.5 rounded-full" :class="env.dot" /> {{ env.label }}
          </span>
        </div>
        <div class="font-semibold text-sm truncate" :class="{ 'font-mono': monoLabel }">
          {{ entry.label }}
        </div>
        <div class="text-xs text-muted truncate min-h-[16px]" :class="{ 'font-mono': monoLabel }">
          {{ subtitle }}
        </div>
      </div>

      <!-- Notes toggle — only when the entry carries notes. @click.stop: must NOT
           bubble to the card's open-detail click. -->
      <UButton
        v-if="entry.notes"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-sticky-note"
        :aria-label="notesOpen ? `Hide notes for ${entry.label}` : `Show notes for ${entry.label}`"
        :aria-expanded="notesOpen"
        class="shrink-0"
        :class="notesOpen && 'text-primary'"
        @click.stop="notesOpen = !notesOpen"
      />

      <!-- LOGIN/SECRET keep the one-tap copy; no chevron — the whole card opens detail. -->
      <UButton
        v-if="canCopy"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-copy"
        :aria-label="`Copy from ${entry.label}`"
        class="shrink-0"
        @click.stop="emit('copy', entry)"
      />
    </div>

    <!-- Explicit expansion: opens only on user action. @click.stop so reading or
         selecting the note text never navigates to the detail. -->
    <div
      v-if="notesOpen"
      data-testid="card-notes"
      class="px-3.5 pb-3.5 pt-3 border-t border-dashed border-default cursor-auto"
      @click.stop
    >
      <div class="text-[10px] font-mono uppercase tracking-wider text-dimmed mb-1">Notes</div>
      <p class="text-xs text-muted leading-relaxed whitespace-pre-wrap break-words">{{ entry.notes }}</p>
    </div>
  </div>
</template>
