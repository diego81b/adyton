<script setup lang="ts">
// Small square brand badge (the emerald-masked logo only, no wordmark). Used in the
// app chrome (sidebar + mobile header). For the full centered brand block on auth
// screens, use BrandLogo instead.
withDefaults(defineProps<{ size?: number }>(), { size: 32 });
</script>

<template>
  <div
    role="img"
    aria-label="Adyton"
    :style="{ width: `${size}px`, height: `${size}px` }"
    class="rounded-lg bg-primary drop-shadow-[0_0_10px_rgba(16,185,129,0.45)] [mask:url(/logo.svg)_center/contain_no-repeat] [-webkit-mask:url(/logo.svg)_center/contain_no-repeat]"
  />
</template>
