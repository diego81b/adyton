<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';

definePageMeta({ ssr: false });
const router = useRouter();
const authStore = useAuthStore();

// Boot redirect: don't force /login unconditionally — a valid session (refresh cookie)
// may still exist from a previous run. Land on /vault instead so the auth middleware's
// existing lock check takes over and routes to /unlock (which auto-attempts biometric)
// rather than discarding a working session on every cold app start.
onMounted(async () => {
  const authenticated = await authStore.initialize();
  await router.replace(authenticated ? '/vault' : '/login');
});
</script>

<template>
  <div />
</template>
