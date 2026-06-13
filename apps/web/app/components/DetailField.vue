<script setup lang="ts">
import { computed } from 'vue';
import { useReveal } from '~/composables/useReveal';
import { useSecureClipboard } from '~/composables/useSecureClipboard';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string;
    mono?: boolean;
    copyable?: boolean;
    revealable?: boolean;
    /** When set, shows an "open external link" button (LOGIN url). */
    link?: string;
  }>(),
  { mono: true, copyable: true, revealable: false },
);

const toast = useToast();
const { isRevealed, toggle } = useReveal();
const { copy } = useSecureClipboard();

const shown = computed(() =>
  !props.revealable || isRevealed('v') ? props.value : '•'.repeat(Math.min(16, props.value.length || 12)),
);

// The link is a user-controlled, client-decrypted value (LOGIN url). Bind only
// http(s)/mailto to href — a javascript:/data: URI would otherwise execute on click.
const safeLink = computed(() => {
  if (!props.link) return null;
  try {
    const u = new URL(props.link, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
});

async function onCopy() {
  const ok = await copy(props.value);
  toast.add(
    ok
      ? { title: 'Copied', description: 'Clears from clipboard in 30s', color: 'success' }
      : { title: 'Copy failed', color: 'error' },
  );
}

// Tile-style action affordance shared with the vault list (VaultEntryCard): a
// bordered square that matches the rest of the app, instead of a loose ghost icon.
// Neutral by default — the page's single accent CTA is Edit (design-system §8).
const TILE = 'size-9 rounded-md border flex items-center justify-center shrink-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const TILE_IDLE = 'bg-muted border-default text-toned hover:bg-primary/10 hover:text-primary hover:border-primary/40';
const TILE_ACTIVE = 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20';
</script>

<template>
  <div class="p-4">
    <div class="text-[11px] font-mono uppercase tracking-wider text-dimmed mb-1.5">{{ label }}</div>
    <div class="flex items-center gap-2">
      <span
        class="flex-1 text-base text-default truncate"
        :class="[mono && 'font-mono tabular-nums', revealable && !isRevealed('v') && 'tracking-wider']"
      >{{ shown }}</span>

      <!-- Action tiles sit tighter on mobile (gap-1) so reveal/redirect/copy read as a
           single control group; they relax to gap-2 from sm up. -->
      <div class="flex items-center gap-1 sm:gap-2 shrink-0">
        <button
          v-if="revealable"
          type="button"
          :class="[TILE, isRevealed('v') ? TILE_ACTIVE : TILE_IDLE]"
          :aria-label="isRevealed('v') ? `Hide ${label}` : `Reveal ${label}`"
          :aria-pressed="isRevealed('v')"
          @click="toggle('v')"
        >
          <UIcon :name="isRevealed('v') ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-5" />
        </button>
        <a
          v-if="safeLink"
          :href="safeLink"
          target="_blank"
          rel="noopener noreferrer"
          :class="[TILE, TILE_IDLE]"
          :aria-label="`Open ${label}`"
        >
          <UIcon name="i-lucide-external-link" class="size-5" />
        </a>
        <!-- Copy is pinned last so it always sits at the row's far right. -->
        <button
          v-if="copyable"
          type="button"
          :class="[TILE, TILE_IDLE]"
          :aria-label="`Copy ${label}`"
          @click="onCopy"
        >
          <UIcon name="i-lucide-copy" class="size-5" />
        </button>
      </div>
    </div>
  </div>
</template>
