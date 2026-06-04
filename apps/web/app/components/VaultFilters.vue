<script setup lang="ts">
import { ref, computed, watch } from 'vue';
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

// DRAFT semantics: pills edit a local draft; the applied filters (the models) only
// change on Done. Closing without Done (backdrop/X) discards the draft.
const draftType = ref<VaultEntryType | 'all'>(type.value);
const draftEnvironment = ref<EnvironmentTag | 'all'>(environment.value);

watch(open, (isOpen) => {
  if (isOpen) {
    draftType.value = type.value;
    draftEnvironment.value = environment.value;
  }
});

// Same responsive pattern as VaultEntryModal: right on desktop, bottom sheet on mobile.
const isDesktop = useMediaQuery('(min-width: 1024px)');
const side = computed<'right' | 'bottom'>(() => (isDesktop.value ? 'right' : 'bottom'));

// Environment is only carried by ENV_FILE + SECRET (invariant #8). For the other types
// it can never match, so the environment filter is only meaningful under 'all' or those
// two types — hidden otherwise.
const ENV_TYPES = new Set<VaultEntryType>([VaultEntryType.ENV_FILE, VaultEntryType.SECRET]);
const showEnvironment = computed(
  () => draftType.value === 'all' || ENV_TYPES.has(draftType.value as VaultEntryType),
);

// Switching to a non-env type clears any draft environment so it can't linger
// invisibly (and skew the active-count badge).
watch(draftType, (t) => {
  if (t !== 'all' && !ENV_TYPES.has(t as VaultEntryType) && draftEnvironment.value !== 'all') {
    draftEnvironment.value = 'all';
  }
});

const activeCount = computed(
  () => (draftType.value !== 'all' ? 1 : 0) + (draftEnvironment.value !== 'all' ? 1 : 0),
);

function reset() {
  draftType.value = 'all';
  draftEnvironment.value = 'all';
}

function apply() {
  type.value = draftType.value;
  environment.value = draftEnvironment.value;
  open.value = false;
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
              :class="chipClass('all', draftType === 'all')"
              @click="draftType = 'all'"
            >
              All <span class="opacity-75 ml-1">{{ counts.all }}</span>
            </button>
            <button
              v-for="f in TYPE_FILTERS"
              :key="f.type"
              type="button"
              class="flex items-center justify-center px-3 py-2.5 rounded-full text-sm font-semibold transition"
              :class="chipClass(f.type, draftType === f.type)"
              @click="draftType = f.type"
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
            v-model="draftEnvironment"
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
          @click="apply"
        />
      </div>
    </template>
  </USlideover>
</template>
