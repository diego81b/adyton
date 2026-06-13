<script setup lang="ts">
// Full-screen shell for auth pages. Mobile (<lg): single centered column — brand
// slot on top, card, badge footer. Desktop (lg+): enterprise split-panel — Blue
// Whale brand/trust panel left, form column right (brand slot hidden; pages put
// their context in the card header instead). Slots: #brand (mobile-only block
// above the card), default (card body), #footer (icon + text badge below card).
withDefaults(
  defineProps<{
    /** Right-column width. md for single-field pages (unlock); lg for wider forms. */
    width?: 'md' | 'lg';
    /** Headline on the desktop brand panel. */
    headline?: string;
    /** Supporting line under the headline. */
    subline?: string;
  }>(),
  {
    width: 'md',
    headline: 'The inner sanctum for your secrets.',
    subline:
      'Self-hosted, zero-knowledge vault for passwords, environment files and production secrets.',
  },
);

const TRUST_POINTS = [
  {
    icon: 'i-lucide-shield-check',
    text: 'AES-256-GCM encryption, performed entirely on your device',
  },
  {
    icon: 'i-lucide-key-round',
    text: 'Argon2id key derivation — your master password never leaves the browser',
  },
  {
    icon: 'i-lucide-eye-off',
    text: 'The server stores opaque ciphertext only. It cannot read your vault',
  },
];
</script>

<template>
  <div class="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:grid-cols-2">
    <!-- Desktop brand panel. Brand pairing rule, theme-aware: light theme shows a
         Jet Stream panel with Blue Whale text; dark theme inverts to a Blue Whale
         panel with Jet Stream text (8.8:1 pair both ways). -->
    <!-- Dark panel is SOLID Blue Whale (#03363D): no gradient or glow overlays,
         so the brand color renders exactly as specified. -->
    <aside
      class="relative hidden overflow-hidden bg-gradient-to-br from-brand-100 to-brand-200 dark:bg-none dark:bg-brand-900 lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14"
    >
      <div class="relative flex items-center gap-3">
        <!-- Fixed-pair mark: BrandMark uses bg-primary, which would wash out
             against the panel in both themes. -->
        <div
          role="img"
          aria-label="Adyton"
          class="size-9 bg-brand-900 dark:bg-brand-200 [mask:url(/logo.svg)_center/contain_no-repeat] [-webkit-mask:url(/logo.svg)_center/contain_no-repeat]"
        />
        <span class="text-xl font-bold tracking-tight text-brand-950 dark:text-brand-50"
          >Adyton</span
        >
      </div>

      <div class="relative max-w-md">
        <h1
          class="text-3xl font-bold leading-tight tracking-tight text-brand-950 dark:text-brand-50 xl:text-4xl"
        >
          {{ headline }}
        </h1>
        <p class="mt-4 text-sm leading-relaxed text-brand-800 dark:text-brand-200">{{ subline }}</p>

        <ul class="mt-10 space-y-4">
          <li v-for="point in TRUST_POINTS" :key="point.icon" class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-brand-900/15 bg-brand-900/10 dark:border-brand-200/20 dark:bg-brand-200/10"
            >
              <UIcon :name="point.icon" class="size-3.5 text-brand-800 dark:text-brand-200" />
            </span>
            <span class="text-sm leading-relaxed text-brand-900 dark:text-brand-100">{{
              point.text
            }}</span>
          </li>
        </ul>
      </div>

      <p
        class="relative font-mono text-[11px] uppercase tracking-widest text-brand-700 dark:text-brand-300"
      >
        Zero-knowledge · End-to-end encrypted · Self-hosted
      </p>
    </aside>

    <!-- Form column. Safe-area aware: on native the page may sit edge-to-edge. -->
    <main
      class="radial-glow flex min-h-dvh items-center justify-center px-5 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))]"
    >
      <div class="w-full" :class="width === 'lg' ? 'max-w-lg' : 'max-w-md'">
        <div v-if="$slots.brand" class="mb-8 lg:hidden">
          <slot name="brand" />
        </div>

        <slot />

        <div
          v-if="$slots.footer"
          class="mt-6 flex items-center justify-center gap-1.5 font-mono text-[11px] text-muted"
        >
          <slot name="footer" />
        </div>
      </div>
    </main>
  </div>
</template>
