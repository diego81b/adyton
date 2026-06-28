<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useCryptoStore } from '../stores/crypto';
import { useSettingsStore } from '../stores/settings';
import { useAutoLock } from '../composables/useAutoLock';
import { useAppChrome } from '../composables/useAppChrome';

const authStore = useAuthStore();
const cryptoStore = useCryptoStore();
const settingsStore = useSettingsStore();
const router = useRouter();
const { countdown } = useAutoLock();
const { title, subtitle } = useAppChrome();

onMounted(() => {
  // Authoritative settings from the server (boot used the localStorage cache).
  // Re-arm the lock timer in case the synced duration differs from the cached one.
  if (!settingsStore.loaded) {
    settingsStore
      .fetchSettings()
      .then(() => {
        if (cryptoStore.isUnlocked) cryptoStore.resetLockTimer();
      })
      .catch(reportError);
  }
});

const avatarLetter = computed(() => (authStore.user?.email ?? '?').charAt(0).toUpperCase());

function lockNow() {
  cryptoStore.lock();
}

async function signOut() {
  await authStore.logout();
  await router.push('/login');
}
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <div class="lg:flex">
      <AppSidebar />

      <div class="flex-1 min-w-0">
        <!-- Mobile header -->
        <header
          class="lg:hidden sticky top-0 z-30 bg-default/85 backdrop-blur-xl border-b border-default pt-[env(safe-area-inset-top,0px)]"
        >
          <div class="px-4 h-14 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <BrandMark :size="28" />
              <span class="font-bold text-base tracking-tight">Adyton</span>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-lock"
                :label="countdown"
                class="font-mono text-xs"
                title="Click to lock vault"
                aria-label="Click to lock vault"
                @click="lockNow"
              />
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                class="rounded-full size-8 justify-center p-0"
                :aria-label="`Signed in as ${authStore.user?.email}`"
                @click="signOut"
              >
                {{ avatarLetter }}
              </UButton>
            </div>
          </div>
        </header>

        <!-- Desktop header -->
        <header
          class="hidden lg:flex sticky top-0 z-30 bg-default/85 backdrop-blur-xl border-b border-default h-14 px-8 items-center justify-between"
        >
          <div>
            <h1 class="text-lg font-bold tracking-tight">{{ title || 'Vault' }}</h1>
            <p v-if="subtitle" class="text-[11px] text-dimmed">{{ subtitle }}</p>
          </div>
          <div class="flex items-center gap-3">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-lock"
              class="font-mono text-xs"
              title="Click to lock vault"
              aria-label="Click to lock vault"
              @click="lockNow"
            >
              <span class="font-mono">{{ countdown }}</span>
              <span class="text-[10px] opacity-70">auto-lock</span>
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              class="rounded-full size-8 justify-center p-0"
              :aria-label="`Signed in as ${authStore.user?.email}`"
              @click="signOut"
            >
              {{ avatarLetter }}
            </UButton>
          </div>
        </header>

        <!-- Wide cap: each page sets its own content width (vault/generator 4xl,
             settings 5xl for the two-column layout). -->
        <main
          class="px-3 sm:px-4 lg:px-8 py-5 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-8 max-w-6xl mx-auto w-full"
        >
          <slot />
        </main>
      </div>

      <AppBottomNav />
    </div>

    <LockOverlay />
  </div>
</template>
