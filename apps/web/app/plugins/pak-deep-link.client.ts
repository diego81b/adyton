// Intercept adyton://pak?d=... deep links on native and navigate to the
// appropriate PAK page. Routing logic lives in utils/pak-url.ts, shared with the
// in-app QR scanner (QrScannerOverlay.vue) so both capture paths stay in sync.
//
// This plugin is a no-op on web — Capacitor App events only fire inside the
// native WebView.
export default defineNuxtPlugin(async () => {
  const { useNativeRuntime } = await import('~/composables/useNativeRuntime');
  const { isNative } = useNativeRuntime();
  if (!isNative) return;

  const { App } = await import('@capacitor/app');
  const { parsePakUrl } = await import('~/utils/pak-url');
  const router = useRouter();

  App.addListener('appUrlOpen', (event: { url: string }) => {
    const route = parsePakUrl(event.url);
    if (!route) return;
    router.push(route);
  });
});
