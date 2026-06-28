// Lock the vault whenever the app moves to the background on native (iOS / Android).
// Biometric re-unlock makes the round-trip cheap, so we lock eagerly on every
// background transition rather than waiting for the auto-lock timer.
// This plugin is a no-op on web — the guard runs once on client-side hydration.
export default defineNuxtPlugin(async () => {
  const { useNativeRuntime } = await import('~/composables/useNativeRuntime');
  const { isNative } = useNativeRuntime();
  if (!isNative) return;

  const { App } = await import('@capacitor/app');
  const { useCryptoStore } = await import('~/stores/crypto');

  // Capacitor plugins are global singletons: clear any listener left by a
  // previous app instance (dev live-reload) so locks never fire twice.
  await App.removeAllListeners();
  await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      useCryptoStore().lock();
    }
  });
});
