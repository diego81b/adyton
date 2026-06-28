<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useRecoveryKit } from '~/composables/useRecoveryKit';

// /pak/recover is reached from /unlock when the user has lost their phone.
// Session is already authenticated (same situation as /unlock — refresh cookie is valid,
// vault key is gone). Mirror /unlock: no auth middleware (which only covers /vault/*),
// manual session hydration in onMounted.
definePageMeta({ ssr: false });

const authStore = useAuthStore();
const router = useRouter();
const { status, error, recover } = useRecoveryKit();

const phraseInput = ref('');

// Parse the textarea into an array of words, trimming whitespace
const words = computed(() =>
  phraseInput.value
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0),
);

const wordCount = computed(() => words.value.length);
const isValidCount = computed(() => wordCount.value === 24);
const isRecovering = computed(() => status.value === 'recovering' || status.value === 'validating');

onMounted(async () => {
  if (!authStore.user) {
    const ok = await authStore.initialize();
    if (!ok) {
      await router.push('/login');
    }
  }
});

async function onRecover() {
  if (!isValidCount.value || isRecovering.value) return;
  await recover(words.value);
}
</script>

<template>
  <AuthShell>
    <template #brand>
      <BrandLogo size="md" />
      <p class="mt-2 text-center text-sm text-muted">Vault recovery</p>
    </template>

    <AuthCard>
      <!-- Desktop context header (brand block is mobile-only in split-panel shell) -->
      <div class="hidden lg:block">
        <h2 class="text-lg font-semibold">Vault Recovery</h2>
        <p class="mb-5 mt-1 text-sm text-muted">
          Enter your 24-word recovery phrase to restore vault access.
        </p>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        class="mb-5"
        :description="error"
      />

      <div class="space-y-4">
        <UFormField
          name="phrase"
          label="Recovery phrase"
          :ui="{ label: 'text-xs font-medium uppercase tracking-wider text-muted' }"
          :help="wordCount > 0 ? `${wordCount} / 24 words` : 'Paste or type all 24 words separated by spaces'"
        >
          <UTextarea
            v-model="phraseInput"
            placeholder="word1 word2 word3 … word24"
            :rows="4"
            class="w-full font-mono text-sm"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            :disabled="isRecovering"
          />
        </UFormField>

        <UButton
          block
          size="lg"
          color="primary"
          :loading="isRecovering"
          :disabled="!isValidCount || isRecovering"
          @click="onRecover"
        >
          {{ isRecovering ? 'Recovering…' : 'Recover vault' }}
        </UButton>

        <p class="text-center text-sm text-muted">
          <NuxtLink
            to="/unlock"
            class="text-muted hover:text-default underline-offset-2 hover:underline"
          >
            Back to unlock
          </NuxtLink>
        </p>
      </div>
    </AuthCard>

    <template #footer>
      <UIcon name="i-lucide-shield-check" class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>Zero-knowledge · Your data stays encrypted, even from us</span>
    </template>
  </AuthShell>
</template>
