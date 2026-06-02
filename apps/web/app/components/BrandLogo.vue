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
        class="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring"
      />
      <!-- logo.svg is a transparent vector using currentColor; <img> can't inherit
           it, so we mask it and paint with bg-primary (emerald brand accent). -->
      <div
        role="img"
        aria-label="Adyton"
        class="relative h-full w-full bg-primary drop-shadow-[0_0_12px_rgba(16,185,129,0.45)] [mask:url(/logo.svg)_center/contain_no-repeat] [-webkit-mask:url(/logo.svg)_center/contain_no-repeat]"
      />
    </div>
    <h1 class="font-bold tracking-tight" :class="titleClass">Adyton</h1>
    <p v-if="tagline" class="mt-1.5 text-sm text-muted">{{ tagline }}</p>
  </div>
</template>
