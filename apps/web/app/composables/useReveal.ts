import { reactive, onScopeDispose } from 'vue';

const HIDE_AFTER_MS = 30_000;

/**
 * Per-field reveal state with an independent auto-hide timer per field. A revealed
 * secret (password, env value, card CVV…) automatically re-masks after 30s so it does
 * not linger on screen. This is a SEPARATE concern from clipboard auto-clear
 * (`useSecureClipboard`): revealing shows the value in the DOM, copying puts it on the
 * clipboard, and each has its own 30s lifetime. Keyed by an arbitrary string so a view
 * with N rows (e.g. an ENV_FILE table) can reveal each row independently.
 */
export function useReveal(hideAfterMs = HIDE_AFTER_MS) {
  const revealed = reactive<Record<string, boolean>>({});
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTimer(key: string) {
    const t = timers.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      timers.delete(key);
    }
  }

  function hide(key: string) {
    revealed[key] = false;
    clearTimer(key);
  }

  function reveal(key: string) {
    revealed[key] = true;
    clearTimer(key);
    timers.set(
      key,
      setTimeout(() => hide(key), hideAfterMs),
    );
  }

  function toggle(key: string) {
    if (revealed[key]) hide(key);
    else reveal(key);
  }

  function isRevealed(key: string): boolean {
    return revealed[key] === true;
  }

  function hideAll() {
    for (const key of Object.keys(revealed)) hide(key);
  }

  onScopeDispose(() => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  });

  return { revealed, reveal, hide, toggle, isRevealed, hideAll, hideAfterMs };
}
