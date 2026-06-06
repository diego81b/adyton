import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';

export default defineNuxtRouteMiddleware(async (to) => {
  // Only protect vault, generator, and settings routes
  const protectedPrefixes = ['/vault', '/generator', '/settings'];
  const isProtected = protectedPrefixes.some(prefix => to.path.startsWith(prefix));
  if (!isProtected) return;

  const authStore = useAuthStore();

  // Try silent refresh if no access token in memory
  const authenticated = await authStore.initialize();
  if (!authenticated) {
    return navigateTo('/login');
  }

  // Vault is locked — redirect to unlock page so user can re-derive key.
  // The crypto store's CryptoKey is lost on page reload (in-memory only by design).
  const cryptoStore = useCryptoStore();
  if (!cryptoStore.isUnlocked && to.path !== '/unlock') {
    return navigateTo('/unlock');
  }
});
