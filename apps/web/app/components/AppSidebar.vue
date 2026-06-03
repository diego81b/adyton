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
  <aside
    class="hidden lg:flex lg:flex-col w-60 shrink-0 bg-elevated/40 border-r border-default h-screen sticky top-0 overflow-y-auto"
  >
    <div class="h-14 px-5 flex items-center gap-2.5 border-b border-default">
      <BrandMark :size="32" />
      <span class="font-bold tracking-tight text-highlighted">Adyton</span>
    </div>

    <nav class="p-3 space-y-1 flex-1">
      <NuxtLink
        v-for="item in NAV_ITEMS"
        :key="item.id"
        :to="item.to"
        class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-left group"
        :class="
          item.id === activeId
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:text-highlighted hover:bg-elevated/60'
        "
      >
        <UIcon
          :name="item.icon"
          class="size-5 shrink-0"
          :class="item.id === activeId ? 'text-primary' : 'text-dimmed'"
        />
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-medium" :class="item.id === activeId ? 'text-primary' : 'text-default'">
            {{ item.label }}
          </span>
          <span class="block text-[10px] truncate" :class="item.id === activeId ? 'text-primary/70' : 'text-dimmed'">
            {{ item.subtitle }}
          </span>
        </span>
      </NuxtLink>
    </nav>

    <div class="p-3 border-t border-default">
      <div class="bg-elevated/40 rounded-lg p-3">
        <div class="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-dimmed mb-1">
          <span class="size-1.5 rounded-full bg-green-500" /> Synced
        </div>
        <p class="text-[11px] text-muted">End-to-end encrypted</p>
      </div>
    </div>
  </aside>
</template>
