<script setup lang="ts">
import { computed } from 'vue';
import { NAV_ITEMS } from '../utils/nav';

// useRoute is a Nuxt auto-import (framework composable) — matches unlock.vue.
const route = useRoute();

const activeId = computed(() => {
  const match = NAV_ITEMS.find((item) => route.path === item.to || route.path.startsWith(`${item.to}/`));
  return match?.id ?? 'vault';
});
</script>

<template>
  <nav
    class="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-default/95 backdrop-blur-xl border-t border-default h-14 grid grid-cols-4"
  >
    <NuxtLink
      v-for="item in NAV_ITEMS"
      :key="item.id"
      :to="item.to"
      class="flex flex-col items-center justify-center gap-0.5 transition"
      :class="item.id === activeId ? 'text-primary' : 'text-dimmed hover:text-default'"
    >
      <UIcon :name="item.icon" class="size-5" />
      <span class="text-[10px]" :class="item.id === activeId ? 'font-semibold' : 'font-medium'">
        {{ item.label }}
      </span>
    </NuxtLink>
  </nav>
</template>
