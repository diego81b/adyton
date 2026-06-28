// Intercept adyton://pak?d=... deep links on native and navigate to the
// appropriate PAK page based on the payload mode field:
//   m='enroll'  → /pak/enroll  (first-time phone enrollment)
//   (none / other) → /pak/approve  (vault unlock approval)
//
// This plugin is a no-op on web — Capacitor App events only fire inside the
// native WebView.
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

      // Peek at the mode field without fully validating the payload — the
      // destination page is responsible for thorough validation.
      let mode: string | undefined;
      try {
        const payload = JSON.parse(atob(d)) as Record<string, unknown>;
        mode = typeof payload['m'] === 'string' ? payload['m'] : undefined;
      } catch {
        // Malformed payload — default to approval page which will show an error.
      }

      if (mode === 'enroll') {
        router.push({ path: '/pak/enroll', query: { d } });
      } else {
        router.push({ path: '/pak/approve', query: { d } });
      }
    } catch {
      // Malformed URL — ignore
    }
  });
});
