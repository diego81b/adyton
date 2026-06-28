import { Capacitor } from '@capacitor/core';

/**
 * Thin wrapper over Capacitor's platform detection API.
 *
 * Returns plain primitives (not reactive refs) — the platform identity does
 * not change at runtime, so there is nothing to watch. Callers can snapshot
 * the values once at setup time.
 */
export function useNativeRuntime(): {
  isNative: boolean;
  platform: 'ios' | 'android' | 'web';
} {
  return {
    isNative: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform() as 'ios' | 'android' | 'web',
  };
}
