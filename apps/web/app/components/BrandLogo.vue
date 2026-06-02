<script setup lang="ts">
import { computed } from 'vue';

// Brand block for auth screens: logo badge + "Adyton" wordmark + optional tagline.
// Uses /logo.svg from public/. Mockup reference: screen-login / screen-register brand.
const props = withDefaults(
  defineProps<{
    /** lg = login (64px badge, 3xl title); md = register (56px badge, 2xl title). */
    size?: 'md' | 'lg';
    tagline?: string;
    /** Emerald pulsing halo behind the badge (used on the unlock screen). */
    pulse?: boolean;
  }>(),
  { size: 'lg' },
);

const badgeClass = computed(() =>
  props.size === 'lg' ? 'h-16 w-16 mb-5' : 'h-14 w-14 mb-4',
);
const titleClass = computed(() =>
  props.size === 'lg' ? 'text-3xl' : 'text-2xl',
);
</script>

<template>
  <div class="text-center">
    <div class="relative inline-block" :class="badgeClass">
      <div
        v-if="pulse"
        class="absolute inset-0 rounded-2xl bg-primary/30 animate-pulse-ring"
      />
      <div
        class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl accent-glow"
      >
        <img src="/logo.svg" alt="Adyton" class="h-full w-full object-cover" >
      </div>
    </div>
    <h1 class="font-bold tracking-tight" :class="titleClass">Adyton</h1>
    <p v-if="tagline" class="mt-1.5 text-sm text-muted">{{ tagline }}</p>
  </div>
</template>
