<script setup lang="ts">
import { computed } from 'vue';
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();

const isNotFound = computed(() => props.error?.statusCode === 404);
const title = computed(() => (isNotFound.value ? 'Page not found' : 'Something went wrong'));
const message = computed(
  () =>
    props.error?.message ||
    (isNotFound.value
      ? "This page doesn't exist yet."
      : 'An unexpected error occurred.'),
);

// clearError with a redirect navigates in-SPA (no full reload), so the in-memory
// vault key survives — you only hit /unlock if the key was already gone.
function backToVault() {
  clearError({ redirect: '/vault' });
}
function goLogin() {
  clearError({ redirect: '/login' });
}
</script>

<template>
  <div class="min-h-screen bg-default text-default bg-grid flex flex-col items-center justify-center px-6">
    <div class="text-center max-w-md">
      <div class="inline-flex mb-6">
        <BrandMark :size="48" />
      </div>

      <p class="font-mono text-5xl font-bold text-primary mb-2">{{ error?.statusCode || 'Error' }}</p>
      <h1 class="text-xl font-bold tracking-tight mb-2">{{ title }}</h1>
      <p class="text-sm text-muted mb-8">{{ message }}</p>

      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <UButton size="lg" class="accent-glow text-white" icon="i-lucide-vault" @click="backToVault">
          Back to vault
        </UButton>
        <UButton size="lg" color="neutral" variant="soft" icon="i-lucide-log-in" @click="goLogin">
          Sign in
        </UButton>
      </div>
    </div>
  </div>
</template>
