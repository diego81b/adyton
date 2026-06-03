import { computed } from 'vue';

interface Chrome {
  title: string;
  subtitle: string;
}

/**
 * Per-page header chrome (title + subtitle) shown in the vault layout's top bar.
 * Pages call `setChrome(...)` (typically inside a `watchEffect`/`onMounted`) so the
 * layout can render a live title and subtitle without prop drilling through slots.
 * Backed by Nuxt `useState` so it survives layout/page boundaries.
 */
export function useAppChrome() {
  const chrome = useState<Chrome>('app-chrome', () => ({ title: '', subtitle: '' }));

  function setChrome(next: Partial<Chrome>) {
    chrome.value = { ...chrome.value, ...next };
  }

  return {
    chrome,
    title: computed(() => chrome.value.title),
    subtitle: computed(() => chrome.value.subtitle),
    setChrome,
  };
}
