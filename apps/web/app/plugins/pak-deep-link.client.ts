// Intercept adyton://pak?d=... deep links on native and navigate to the PAK
// approval page. This plugin is a no-op on web — Capacitor App events only
// fire inside the native WebView.
export default defineNuxtPlugin(async () => {
  const { useNativeRuntime } = await import('~/composables/useNativeRuntime');
  const { isNative } = useNativeRuntime();
  if (!isNative) return;

  const { App } = await import('@capacitor/app');
  const router = useRouter();

  App.addListener('appUrlOpen', (event: { url: string }) => {
    const url = event.url;
    if (!url.startsWith('adyton://pak')) return;

    try {
      const urlObj = new URL(url);
      const d = urlObj.searchParams.get('d');
      if (!d) return;
      // Navigate to the approval page with the encoded QR payload
      router.push({ path: '/pak/approve', query: { d } });
    } catch {
      // Malformed URL — ignore
    }
  });
});
