<script setup lang="ts">
import { onMounted } from 'vue';
import { useGenerator, type GeneratorMode } from '~/composables/useGenerator';
import { useAppChrome } from '~/composables/useAppChrome';
import { useSecureClipboard } from '~/composables/useSecureClipboard';

definePageMeta({ ssr: false, layout: 'vault', middleware: 'auth' });

const { setChrome } = useAppChrome();
const { copy } = useSecureClipboard();
const toast = useToast();

const { mode, passwordOptions, wordCount, generated, words, error, entropyBits, strength, regenerate } =
  useGenerator();

onMounted(() => setChrome({ title: 'Password Generator', subtitle: 'Strong passwords and passphrases on demand' }));

const MODES: Array<{ id: GeneratorMode; label: string }> = [
  { id: 'password', label: 'Password' },
  { id: 'passphrase', label: 'Passphrase' },
];

const CHAR_CLASSES = [
  { key: 'uppercase', label: 'Uppercase', hint: 'A–Z' },
  { key: 'lowercase', label: 'Lowercase', hint: 'a–z' },
  { key: 'numbers', label: 'Numbers', hint: '0–9' },
  { key: 'symbols', label: 'Symbols', hint: '!@#$%^&' },
] as const;

async function onCopy() {
  if (!generated.value) return;
  const ok = await copy(generated.value);
  toast.add(
    ok
      ? { title: 'Copied', description: 'Clears from clipboard in 30s', color: 'success' }
      : { title: 'Copy failed', color: 'error' },
  );
}
</script>

<template>
  <!-- Same content width as the vault pages (the mockup's narrower 3xl made this
       page look misaligned next to the others). -->
  <div class="mx-auto w-full max-w-4xl">
    <!-- Mode toggle -->
    <div class="mb-4 inline-flex rounded-xl border border-default bg-elevated p-1">
      <button
        v-for="m in MODES"
        :key="m.id"
        type="button"
        class="rounded-lg px-4 py-1.5 text-sm font-semibold transition"
        :class="mode === m.id ? 'bg-primary/15 text-primary' : 'text-muted hover:text-highlighted'"
        @click="mode = m.id"
      >{{ m.label }}</button>
    </div>

    <GeneratedSecret
      class="mb-4"
      :value="generated"
      :words="mode === 'passphrase' ? words : undefined"
      :error="error"
      @copy="onCopy"
      @regenerate="regenerate"
    />

    <EntropyMeter class="mb-4" :bits="entropyBits" :strength="strength" />

    <!-- Controls -->
    <div class="space-y-5 rounded-2xl border border-default bg-elevated p-5">
      <!-- Length / word count slider -->
      <div v-if="mode === 'password'">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-medium text-toned">Length</span>
          <span class="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-sm font-semibold text-primary">
            {{ passwordOptions.length }}
          </span>
        </div>
        <USlider v-model="passwordOptions.length" :min="12" :max="64" :step="1" />
        <div class="mt-1.5 flex justify-between font-mono text-[11px] text-dimmed">
          <span>12</span>
          <span>64</span>
        </div>
      </div>
      <div v-else>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-medium text-toned">Words</span>
          <span class="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-sm font-semibold text-primary">
            {{ wordCount }}
          </span>
        </div>
        <USlider v-model="wordCount" :min="3" :max="10" :step="1" />
        <div class="mt-1.5 flex justify-between font-mono text-[11px] text-dimmed">
          <span>3</span>
          <span>10</span>
        </div>
      </div>

      <template v-if="mode === 'password'">
        <USeparator />

        <!-- Character options -->
        <div>
          <div class="mb-3 text-sm font-medium text-toned">Include</div>
          <div class="grid grid-cols-2 gap-2.5">
            <label
              v-for="cls in CHAR_CLASSES"
              :key="cls.key"
              class="flex cursor-pointer items-center gap-2.5 rounded-lg border border-default bg-accented/50 px-3 py-2.5 transition hover:bg-accented"
            >
              <UCheckbox v-model="passwordOptions[cls.key]" />
              <span class="flex-1">
                <span class="block text-base font-medium">{{ cls.label }}</span>
                <span class="block font-mono text-[11px] text-dimmed">{{ cls.hint }}</span>
              </span>
            </label>
          </div>

          <label
            class="mt-2.5 flex cursor-pointer items-center gap-2.5 rounded-lg border border-default bg-accented/50 px-3 py-2.5 transition hover:bg-accented"
          >
            <UCheckbox v-model="passwordOptions.excludeAmbiguous" />
            <span class="flex-1">
              <span class="block text-base font-medium">Exclude ambiguous</span>
              <span class="block font-mono text-[11px] text-dimmed">O 0 I l 1</span>
            </span>
          </label>
        </div>
      </template>
    </div>
  </div>
</template>
