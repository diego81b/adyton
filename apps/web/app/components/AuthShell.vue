<script setup lang="ts">
// Full-screen shell for auth pages: emerald grid backdrop + radial glow, centered
// column with a translucent card. Slots: #brand (above card), default (card body),
// #footer (mono badge below card). Mockup reference: screen-login / register / unlock.
withDefaults(
  defineProps<{
    /** Column width. md for single-card auth pages; lg for wider forms; 5xl for the dual-state unlock layout. */
    width?: 'md' | 'lg' | '5xl';
  }>(),
  { width: 'md' },
);
</script>

<template>
  <div class="bg-grid radial-glow flex min-h-screen items-center justify-center px-5 py-12">
    <div class="w-full" :class="width === '5xl' ? 'max-w-5xl' : width === 'lg' ? 'max-w-lg' : 'max-w-md'">
      <div v-if="$slots.brand" class="mb-8">
        <slot name="brand" />
      </div>

      <slot />

      <p v-if="$slots.footer" class="mt-6 text-center font-mono text-[11px] text-muted">
        <slot name="footer" />
      </p>
    </div>
  </div>
</template>
