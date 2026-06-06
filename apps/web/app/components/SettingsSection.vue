<script setup lang="ts">
defineProps<{
  id: string;
  title: string;
  icon: string;
  danger?: boolean;
}>();
</script>

<template>
  <section :id="id" class="scroll-mt-20">
    <div class="mb-4 flex items-center gap-2">
      <UIcon :name="icon" class="size-4" :class="danger ? 'text-rose-400' : 'text-primary'" />
      <h2 class="text-base font-bold tracking-tight" :class="danger ? 'text-rose-400' : ''">
        {{ title }}
      </h2>
    </div>
    <slot />
  </section>
</template>
