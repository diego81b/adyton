import { ref, onScopeDispose } from 'vue';

const CLEAR_AFTER_MS = 30_000;

/**
 * Copy a secret to the clipboard and automatically clear it after 30s, so a copied
 * password/token does not linger. Returns `copy()` and a reactive `copied` flag.
 * Clearing only overwrites if the clipboard still holds what we wrote (best-effort;
 * the browser may deny read access, in which case we clear unconditionally).
 */
export function useSecureClipboard() {
  const copied = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastCopied = '';

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      copied.value = false;
      return false;
    }
    lastCopied = text;
    copied.value = true;
    cancel();
    timer = setTimeout(async () => {
      try {
        let current = '';
        try {
          current = await navigator.clipboard.readText();
        } catch {
          current = lastCopied; // can't read — assume still ours, clear anyway
        }
        if (current === lastCopied) await navigator.clipboard.writeText('');
      } catch {
        // ignore — clipboard may be unavailable
      }
      copied.value = false;
      lastCopied = '';
    }, CLEAR_AFTER_MS);
    return true;
  }

  onScopeDispose(cancel);

  return { copy, copied, clearAfterMs: CLEAR_AFTER_MS };
}
