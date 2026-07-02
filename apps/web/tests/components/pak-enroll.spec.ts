// Regression tests for apps/web/app/pages/pak/enroll.vue.
//
// Bug 1: the unauthenticated bounce to /login dropped the QR ?d= payload and the
// intended destination, so the user never returned to the enroll flow after signing in.
// Bug 2: the vault-key poll checked response.status === 'pending', but the backend
// (EnrollVaultStatusResponseDto) only ever sends 'waiting' | 'ready'. Every poll before
// the desktop actually submits the vault key fell through to the 'ready' branch with no
// ciphertext/iv, firing "Received incomplete vault key payload" almost immediately.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

const mockGenerateEphemeralKeypair = vi.fn();
const mockExportPublicKeySpki = vi.fn();
const mockImportPublicKeySpki = vi.fn();
const mockDeriveQrSessionKey = vi.fn();
const mockDecryptFromTransport = vi.fn();

vi.mock('@adyton/shared', async (orig) => {
  const real = await orig<typeof import('@adyton/shared')>();
  return {
    ...real,
    generateEphemeralKeypair: () => mockGenerateEphemeralKeypair(),
    exportPublicKeySpki: (...args: unknown[]) => mockExportPublicKeySpki(...args),
    importPublicKeySpki: (...args: unknown[]) => mockImportPublicKeySpki(...args),
    deriveQrSessionKey: (...args: unknown[]) => mockDeriveQrSessionKey(...args),
    decryptFromTransport: (...args: unknown[]) => mockDecryptFromTransport(...args),
  };
});

const mockGenerateKeys = vi.fn();
const mockGetPublicKeys = vi.fn();
const mockSign = vi.fn();
const mockSealVaultKey = vi.fn();
vi.mock('@adyton/capacitor-keystore', () => ({
  AdytonKeystore: {
    generateKeys: (...args: unknown[]) => mockGenerateKeys(...args),
    getPublicKeys: (...args: unknown[]) => mockGetPublicKeys(...args),
    sign: (...args: unknown[]) => mockSign(...args),
    sealVaultKey: (...args: unknown[]) => mockSealVaultKey(...args),
  },
}));

vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: true, platform: 'android' }),
}));

const { useAuthStore } = await import('../../app/stores/auth');

const mockPush = vi.fn();
const mockRouteQuery = ref<Record<string, string>>({});
const mockFullPath = ref('/pak/enroll');
vi.stubGlobal('useRouter', () => ({ push: mockPush }));
vi.stubGlobal('useRoute', () => ({ query: mockRouteQuery.value, fullPath: mockFullPath.value }));
vi.stubGlobal('definePageMeta', vi.fn());

const stubs = {
  UIcon: { name: 'UIcon', template: '<i />' },
  UAlert: { name: 'UAlert', props: ['description', 'title'], template: '<div class="ualert">{{ title }} {{ description }}</div>' },
  UButton: { name: 'UButton', template: '<button><slot /></button>' },
};

import EnrollPage from '../../app/pages/pak/enroll.vue';

function qrPayload(overrides: Partial<{ s: string; p: string; c: string; m: string }> = {}) {
  return btoa(JSON.stringify({ s: 'sess-1', p: 'desktop-pub-b64', c: 'a'.repeat(64), m: 'enroll', ...overrides }));
}

function deviceResponse() {
  return {
    id: 'device-1',
    deviceName: 'My Phone',
    platform: 'android',
    enrollmentMethod: 'master_password',
    enrolledAt: '2026-07-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    publicKeyFingerprint: 'fp',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockPush.mockResolvedValue(undefined);
  mockRouteQuery.value = { d: qrPayload() };
  mockFullPath.value = '/pak/enroll?d=' + qrPayload();

  mockGenerateEphemeralKeypair.mockResolvedValue({ privateKey: {}, publicKey: {} });
  mockExportPublicKeySpki.mockResolvedValue('eph-pub-b64');
  mockGenerateKeys.mockResolvedValue(undefined);
  mockGetPublicKeys.mockResolvedValue({ ecdhPublicKey: 'device-ecdh-pub' });
  mockSign.mockResolvedValue({ signatureBase64: 'sig-b64' });
});

afterEach(() => {
  vi.useRealTimers();
});

function mountPage() {
  return mount(EnrollPage, { global: { stubs } });
}

describe('pak/enroll page — unauthenticated redirect (regression)', () => {
  it('preserves the QR payload and destination when bouncing to /login', async () => {
    const auth = useAuthStore();
    auth.user = null;
    vi.spyOn(auth, 'initialize').mockResolvedValue(false);

    mountPage();
    await flushPromises();

    expect(mockPush).toHaveBeenCalledWith({ path: '/login', query: { redirect: mockFullPath.value } });
  });
});

describe('pak/enroll page — vault-key poll status handling (regression)', () => {
  beforeEach(() => {
    const auth = useAuthStore();
    auth.user = { id: 'user-1', email: 'test@example.com', kdfSalt: 'a'.repeat(64), totpEnabled: false };
  });

  it('keeps polling on status "waiting" instead of reporting an incomplete payload', async () => {
    const auth = useAuthStore();
    const apiFetch = vi.spyOn(auth, 'apiFetch')
      .mockResolvedValueOnce(deviceResponse()) // POST /pak/devices/enroll
      .mockResolvedValueOnce({ status: 'waiting' }) // first poll
      .mockResolvedValueOnce({ status: 'waiting' }); // second poll

    const w = mountPage();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();

    expect(apiFetch).toHaveBeenCalledWith(`/auth/enroll-vault/sess-1`);
    expect(w.text()).not.toContain('incomplete');
    expect(mockSealVaultKey).not.toHaveBeenCalled();
  });

  it('proceeds to seal the vault key on status "ready" with ciphertext/iv', async () => {
    const auth = useAuthStore();
    vi.spyOn(auth, 'apiFetch')
      .mockResolvedValueOnce(deviceResponse()) // POST /pak/devices/enroll
      .mockResolvedValueOnce({ status: 'ready', ciphertext: 'ct-b64', iv: 'iv-b64' }); // poll

    mockImportPublicKeySpki.mockResolvedValue({});
    mockDeriveQrSessionKey.mockResolvedValue({});
    mockDecryptFromTransport.mockResolvedValue(new Uint8Array(32).buffer);
    mockSealVaultKey.mockResolvedValue(undefined);

    const w = mountPage();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();

    expect(mockSealVaultKey).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: expect.any(String) }),
    );
    expect(w.text()).not.toContain('incomplete');
    expect(mockPush).toHaveBeenCalledWith('/vault');
  });
});
