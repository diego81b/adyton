<script setup lang="ts">
// Translucent card used by every auth screen. Concrete Tailwind + NuxtUI design
// tokens (bg-elevated / border-default flip with the theme automatically), so the
// styling stays in one reusable component rather than scattered CSS.
</script>

<template>
  <div class="rounded-2xl border border-default bg-elevated/80 p-7 backdrop-blur-sm">
    <slot />
  </div>
</template>
