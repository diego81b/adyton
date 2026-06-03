<script setup lang="ts">
import { computed, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { VaultEntryType, type EnvironmentTag } from '@adyton/shared';
import { TYPE_FILTERS, chipClass } from '~/utils/entry-display';

// Filters live in a slideover so the list view stays clean. Type filter + environment
// only — search stays inline on the page (primary, high-frequency action).
defineProps<{
  counts: Record<string, number>;
  envOptions: { value: EnvironmentTag | 'all'; label: string }[];
}>();

const open = defineModel<boolean>('open', { required: true });
const type = defineModel<VaultEntryType | 'all'>('type', { required: true });
const environment = defineModel<EnvironmentTag | 'all'>('environment', { required: true });

// Same responsive pattern as VaultEntryModal: right on desktop, bottom sheet on mobile.
const isDesktop = useMediaQuery('(min-width: 1024px)');
const side = computed<'right' | 'bottom'>(() => (isDesktop.value ? 'right' : 'bottom'));

// Environment is only carried by ENV_FILE + SECRET (invariant #8). For the other types
// it can never match, so the environment filter is only meaningful under 'all' or those
// two types — hidden otherwise.
const ENV_TYPES = new Set<VaultEntryType>([VaultEntryType.ENV_FILE, VaultEntryType.SECRET]);
const showEnvironment = computed(
  () => type.value === 'all' || ENV_TYPES.has(type.value as VaultEntryType),
);

// Switching to a non-env type clears any active environment filter so it can't linger
// invisibly (and skew the active-count badge).
watch(type, (t) => {
  if (t !== 'all' && !ENV_TYPES.has(t as VaultEntryType) && environment.value !== 'all') {
    environment.value = 'all';
  }
});

const activeCount = computed(
  () => (type.value !== 'all' ? 1 : 0) + (environment.value !== 'all' ? 1 : 0),
);

function reset() {
  type.value = 'all';
  environment.value = 'all';
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="side"
    title="Filters"
    :ui="{ content: 'w-full max-w-none lg:max-w-sm' }"
  >
    <template #body>
      <div class="space-y-6">
        <!-- Type -->
        <div>
          <div class="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Type</div>
          <!-- Uniform-size chips: a 2-col grid makes every pill the same width. -->
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="flex items-center justify-center px-3 py-2.5 rounded-full text-sm font-semibold transition"
              :class="chipClass('all', type === 'all')"
              @click="type = 'all'"
            >
              All <span class="opacity-75 ml-1">{{ counts.all }}</span>
            </button>
            <button
              v-for="f in TYPE_FILTERS"
              :key="f.type"
              type="button"
              class="flex items-center justify-center px-3 py-2.5 rounded-full text-sm font-semibold transition"
              :class="chipClass(f.type, type === f.type)"
              @click="type = f.type"
            >
              {{ f.label }} <span class="opacity-75 ml-1">{{ counts[f.type] }}</span>
            </button>
          </div>
        </div>

        <!-- Environment — only for env-carrying types (ENV_FILE / SECRET) or 'all'. -->
        <div v-if="showEnvironment">
          <div class="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">
            Environment
          </div>
          <USelect
            v-model="environment"
            :items="envOptions"
            value-key="value"
            size="lg"
            class="w-full"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2 w-full">
        <UButton
          color="neutral"
          variant="soft"
          size="lg"
          class="flex-1 justify-center"
          :disabled="activeCount === 0"
          label="Reset"
          @click="reset"
        />
        <UButton
          color="primary"
          size="lg"
          class="flex-1 justify-center"
          label="Done"
          @click="open = false"
        />
      </div>
    </template>
  </USlideover>
</template>
