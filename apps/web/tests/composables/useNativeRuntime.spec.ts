import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @capacitor/core — static import in useNativeRuntime.ts.
// We stub Capacitor's two relevant methods before importing the composable.
// ---------------------------------------------------------------------------
const mockIsNativePlatform = vi.fn<[], boolean>(() => false);
const mockGetPlatform = vi.fn<[], string>(() => 'web');

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
    getPlatform: () => mockGetPlatform(),
  },
}));

import { useNativeRuntime } from '../../app/composables/useNativeRuntime';

beforeEach(() => {
  mockIsNativePlatform.mockReturnValue(false);
  mockGetPlatform.mockReturnValue('web');
});

describe('useNativeRuntime', () => {
  it('isNative is false on web platform', () => {
    mockIsNativePlatform.mockReturnValue(false);
    const { isNative } = useNativeRuntime();
    expect(isNative).toBe(false);
  });

  it('isNative is true on native platform', () => {
    mockIsNativePlatform.mockReturnValue(true);
    const { isNative } = useNativeRuntime();
    expect(isNative).toBe(true);
  });

  it('platform is "web" when getPlatform returns web', () => {
    mockGetPlatform.mockReturnValue('web');
    const { platform } = useNativeRuntime();
    expect(platform).toBe('web');
  });

  it('platform is "ios" when getPlatform returns ios', () => {
    mockGetPlatform.mockReturnValue('ios');
    const { platform } = useNativeRuntime();
    expect(platform).toBe('ios');
  });

  it('platform is "android" when getPlatform returns android', () => {
    mockGetPlatform.mockReturnValue('android');
    const { platform } = useNativeRuntime();
    expect(platform).toBe('android');
  });

  it('returns a fresh snapshot each call (not reactive — values are primitives)', () => {
    mockIsNativePlatform.mockReturnValue(false);
    const first = useNativeRuntime();
    mockIsNativePlatform.mockReturnValue(true);
    const second = useNativeRuntime();
    // Each call snapshots the current Capacitor state.
    expect(first.isNative).toBe(false);
    expect(second.isNative).toBe(true);
  });
});
