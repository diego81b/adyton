<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useVaultStore } from '~/stores/vault';
import { useVaultExport } from '~/composables/useVaultExport';
import { usePasswordStrength } from '~/composables/usePasswordStrength';
import PasswordInput from './PasswordInput.vue';
import PasswordStrengthMeter from './PasswordStrengthMeter.vue';

const open = defineModel<boolean>({ required: true });

const vault = useVaultStore();
const { exporting, downloadExport } = useVaultExport();

const password = ref('');
const errorMsg = ref('');
const done = ref(false);

const { score, label, labelColor, bits, segColor, validating } = usePasswordStrength(password);

const canExport = computed(() => password.value.length >= 8 && !exporting.value);

watch(open, (isOpen) => {
  if (isOpen) {
    password.value = '';
    errorMsg.value = '';
    done.value = false;
  }
});

async function onExport() {
  if (!canExport.value) return;
  errorMsg.value = '';
  try {
    await downloadExport(password.value);
    done.value = true;
  } catch {
    errorMsg.value = 'Export failed. Please try again.';
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Export vault">
    <template #content>
      <div class="p-5 space-y-4">
        <div class="flex items-center gap-2.5">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <UIcon name="i-lucide-download" class="size-4 text-emerald-400" />
          </div>
          <h2 class="font-bold tracking-tight">Export vault</h2>
        </div>

        <p class="text-sm text-toned leading-relaxed">
          Downloads an encrypted <span class="font-mono">.adyton</span> file containing
          <strong class="text-highlighted">{{ vault.entries.length }} {{ vault.entries.length === 1 ? 'entry' : 'entries' }}</strong>.
          The file is protected by a separate export password — anyone who has the file
          <em>and</em> the password can decrypt it.
        </p>

        <template v-if="!done">
          <UFormField label="Export password" name="export-password">
            <PasswordInput
              v-model="password"
              class="w-full"
              placeholder="Choose a strong export password"
              autocomplete="new-password"
            />
          </UFormField>

          <PasswordStrengthMeter
            v-if="password"
            :score="score"
            :label="label"
            :label-color="labelColor"
            :bits="bits"
            :seg-color="segColor"
            :validating="validating"
          />

          <p v-if="errorMsg" class="text-xs text-error">{{ errorMsg }}</p>

          <div class="flex gap-2 pt-1">
            <UButton
              color="neutral"
              variant="soft"
              size="lg"
              class="flex-1 justify-center"
              @click="open = false"
            >
              Cancel
            </UButton>
            <UButton
              color="primary"
              size="lg"
              class="flex-1 justify-center"
              :disabled="!canExport"
              :loading="exporting"
              icon="i-lucide-download"
              @click="onExport"
            >
              <span class="hidden sm:inline">Download export</span>
              <span class="sm:hidden">Download</span>
            </UButton>
          </div>
        </template>

        <template v-else>
          <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300 leading-relaxed">
            <UIcon name="i-lucide-check-circle" class="inline size-4 mr-1 align-text-bottom" />
            Export downloaded. Store it safely together with the export password — both are required to restore.
          </div>
          <div class="flex gap-2">
            <UButton color="neutral" variant="soft" size="lg" class="flex-1 justify-center" @click="open = false">
              Close
            </UButton>
            <UButton color="neutral" variant="subtle" size="lg" class="flex-1 justify-center" @click="done = false">
              Export again
            </UButton>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
