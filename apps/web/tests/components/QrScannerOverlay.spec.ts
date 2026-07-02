import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

type Handler = (event: unknown) => void;
let barcodesHandler: Handler | undefined;
let scanErrorHandler: Handler | undefined;

// vi.mock factories are hoisted above top-level const declarations — vi.hoisted()
// creates these mocks in that same hoisted scope so the factory below can see them.
const {
  mockCheckPermissions,
  mockRequestPermissions,
  mockStartScan,
  mockStopScan,
  mockOpenSettings,
  mockRemove,
  mockAddListener,
} = vi.hoisted(() => {
  const mockRemove = vi.fn();
  return {
    mockCheckPermissions: vi.fn(),
    mockRequestPermissions: vi.fn(),
    mockStartScan: vi.fn(),
    mockStopScan: vi.fn(),
    mockOpenSettings: vi.fn(),
    mockRemove,
    mockAddListener: vi.fn(async (event: string, handler: Handler) => {
      // Closure over the module-level `let`s below: this function only runs later,
      // when the mounted component calls addListener(), by which point they're
      // long since assigned — safe despite vi.hoisted() running before that `let`.
      if (event === 'barcodesScanned') barcodesHandler = handler;
      if (event === 'scanError') scanErrorHandler = handler;
      return { remove: mockRemove };
    }),
  };
});

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: {
    checkPermissions: mockCheckPermissions,
    requestPermissions: mockRequestPermissions,
    addListener: mockAddListener,
    startScan: mockStartScan,
    stopScan: mockStopScan,
    openSettings: mockOpenSettings,
  },
}));

const mockPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const stubs = {
  UButton: {
    name: 'UButton',
    props: ['ariaLabel'],
    emits: ['click'],
    template: '<button :aria-label="ariaLabel" @click="$emit(\'click\')"><slot /></button>',
  },
  UIcon: { name: 'UIcon', props: ['name'], template: '<i :data-icon="name" />' },
  UAlert: {
    name: 'UAlert',
    props: ['description'],
    template: '<div class="ualert">{{ description }}</div>',
  },
};

import QrScannerOverlay from '../../app/components/QrScannerOverlay.vue';

beforeEach(() => {
  vi.clearAllMocks();
  barcodesHandler = undefined;
  scanErrorHandler = undefined;
  mockCheckPermissions.mockResolvedValue({ camera: 'granted' });
  mockRequestPermissions.mockResolvedValue({ camera: 'granted' });
  mockStartScan.mockResolvedValue(undefined);
  mockStopScan.mockResolvedValue(undefined);
  document.documentElement.className = '';
  document.body.className = '';
});

function mountOverlay() {
  return mount(QrScannerOverlay, { global: { stubs } });
}

describe('QrScannerOverlay', () => {
  it('starts scanning immediately when permission is already granted', async () => {
    const w = mountOverlay();
    await flushPromises();

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockStartScan).toHaveBeenCalled();
    expect(document.documentElement.classList.contains('qr-scanner-transparent')).toBe(true);
    expect(document.body.classList.contains('qr-scanner-transparent')).toBe(true);
    expect(w.text()).toContain('Point the camera at the PAK QR code');
  });

  it('requests permission when not yet granted, then starts scanning', async () => {
    mockCheckPermissions.mockResolvedValue({ camera: 'prompt' });
    mountOverlay();
    await flushPromises();

    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(mockStartScan).toHaveBeenCalled();
  });

  it('shows the denied state with an Open Settings button when permission is refused', async () => {
    mockCheckPermissions.mockResolvedValue({ camera: 'prompt' });
    mockRequestPermissions.mockResolvedValue({ camera: 'denied' });
    const w = mountOverlay();
    await flushPromises();

    expect(mockStartScan).not.toHaveBeenCalled();
    expect(w.text()).toContain('Camera access is needed');

    await w.find('button:not([aria-label])').trigger('click');
    // The first non-aria-label button in this state is "Open Settings".
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  it('navigates to the resolved PAK route on a valid scan and stops scanning', async () => {
    mountOverlay();
    await flushPromises();

    const d = btoa(JSON.stringify({ m: 'enroll' }));
    barcodesHandler!({ barcodes: [{ rawValue: `adyton://pak?d=${d}` }] });
    await flushPromises();

    expect(mockStopScan).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ path: '/pak/enroll', query: { d } });
    expect(document.body.classList.contains('qr-scanner-transparent')).toBe(false);
  });

  it('shows an inline error and keeps scanning on a non-PAK barcode', async () => {
    const w = mountOverlay();
    await flushPromises();

    barcodesHandler!({ barcodes: [{ rawValue: 'https://example.com' }] });
    await flushPromises();

    expect(w.find('.ualert').text()).toContain('Not an Adyton phone-key QR code');
    expect(mockStopScan).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows the error state when the plugin reports a scan error', async () => {
    const w = mountOverlay();
    await flushPromises();

    scanErrorHandler!({ message: 'Google Barcode Scanner module not available' });
    await flushPromises();

    expect(w.text()).toContain('Google Barcode Scanner module not available');
    expect(document.body.classList.contains('qr-scanner-transparent')).toBe(false);
  });

  it('cancel button stops scanning and navigates to /vault', async () => {
    const w = mountOverlay();
    await flushPromises();

    await w.find('[aria-label="Cancel scan"]').trigger('click');
    await flushPromises();

    expect(mockStopScan).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/vault');
  });

  it('stops scanning and removes listeners on unmount', async () => {
    const w = mountOverlay();
    await flushPromises();

    w.unmount();
    await flushPromises();

    expect(mockStopScan).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledTimes(2);
    expect(document.documentElement.classList.contains('qr-scanner-transparent')).toBe(false);
  });
});
