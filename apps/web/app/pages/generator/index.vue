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
    <div class="mb-3 flex w-full rounded-xl border border-default bg-elevated p-1 sm:mx-auto sm:w-fit">
      <button
        v-for="m in MODES"
        :key="m.id"
        type="button"
        class="flex-1 rounded-lg px-4 py-1.5 text-sm font-semibold transition sm:flex-none sm:min-w-44 sm:px-8 sm:py-2.5 sm:text-base"
        :class="mode === m.id ? 'bg-primary/15 text-primary' : 'text-muted hover:text-highlighted'"
        @click="mode = m.id"
      >{{ m.label }}</button>
    </div>

    <!-- Length / word count slider — kept ABOVE the output so dragging it never
         shifts under the cursor when the generated secret grows taller (64 chars). -->
    <div class="mb-3 rounded-xl border border-default bg-elevated p-3">
      <div v-if="mode === 'password'">
        <div class="mb-2 text-sm font-medium text-toned">Length</div>
        <USlider v-model="passwordOptions.length" :min="12" :max="64" :step="1" tooltip />
        <div class="mt-3 flex justify-between font-mono text-[11px] text-dimmed">
          <span>12</span>
          <span>64</span>
        </div>
      </div>
      <div v-else>
        <div class="mb-2 text-sm font-medium text-toned">Words</div>
        <USlider v-model="wordCount" :min="3" :max="10" :step="1" tooltip />
        <div class="mt-3 flex justify-between font-mono text-[11px] text-dimmed">
          <span>3</span>
          <span>10</span>
        </div>
      </div>
    </div>

    <EntropyMeter class="mb-3" :bits="entropyBits" :strength="strength" />

    <!-- Character options (password only) -->
    <div v-if="mode === 'password'" class="mb-3 rounded-xl border border-default bg-elevated p-3">
      <div>
        <div class="mb-1.5 text-sm font-medium text-toned">Include</div>
          <div class="grid grid-cols-2 gap-2">
            <label
              v-for="cls in CHAR_CLASSES"
              :key="cls.key"
              class="flex cursor-pointer items-center gap-2.5 rounded-lg border border-default bg-accented/50 px-3 py-1.5 transition hover:bg-accented"
            >
              <UCheckbox v-model="passwordOptions[cls.key]" />
              <span class="flex-1">
                <span class="block text-base font-medium">{{ cls.label }}</span>
                <span class="block font-mono text-[13px] text-dimmed">{{ cls.hint }}</span>
              </span>
            </label>
          </div>

          <label
            class="mt-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg border border-default bg-accented/50 px-3 py-1.5 transition hover:bg-accented"
          >
            <UCheckbox v-model="passwordOptions.excludeAmbiguous" />
            <span class="flex-1">
              <span class="block text-base font-medium">Exclude ambiguous</span>
              <span class="block font-mono text-[13px] text-dimmed">O 0 I l 1</span>
            </span>
          </label>
        </div>
    </div>

    <!-- Generated output last so growth (up to 64 chars) never shifts the controls above. -->
    <GeneratedSecret
      :value="generated"
      :words="mode === 'passphrase' ? words : undefined"
      :error="error"
      @copy="onCopy"
      @regenerate="regenerate"
    />
  </div>
</template>
