// Regression test for apps/web/app/pages/pak/approve.vue: the unauthenticated bounce
// to /login dropped the QR ?d= payload and the intended destination (same bug as
// pak/enroll.vue — see pak-enroll.spec.ts for the fuller writeup).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

vi.mock('@adyton/capacitor-keystore', () => ({
  AdytonKeystore: {
    hasKeys: vi.fn(),
    sign: vi.fn(),
    encryptForRelay: vi.fn(),
  },
}));

vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: true, platform: 'android' }),
}));

const { useAuthStore } = await import('../../app/stores/auth');

const mockPush = vi.fn();
const mockRouteQuery = ref<Record<string, string>>({ d: 'irrelevant-for-this-test' });
const mockFullPath = ref('/pak/approve?d=irrelevant-for-this-test');
vi.stubGlobal('useRouter', () => ({ push: mockPush }));
vi.stubGlobal('useRoute', () => ({ query: mockRouteQuery.value, fullPath: mockFullPath.value }));
vi.stubGlobal('definePageMeta', vi.fn());

const stubs = {
  UIcon: { name: 'UIcon', template: '<i />' },
  UAlert: { name: 'UAlert', props: ['description', 'title'], template: '<div class="ualert">{{ title }} {{ description }}</div>' },
  UButton: { name: 'UButton', template: '<button><slot /></button>' },
};

import ApprovePage from '../../app/pages/pak/approve.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockPush.mockResolvedValue(undefined);
});

describe('pak/approve page — unauthenticated redirect (regression)', () => {
  it('preserves the QR payload and destination when bouncing to /login', async () => {
    const auth = useAuthStore();
    auth.user = null;
    vi.spyOn(auth, 'initialize').mockResolvedValue(false);

    mount(ApprovePage, { global: { stubs } });
    await flushPromises();

    expect(mockPush).toHaveBeenCalledWith({ path: '/login', query: { redirect: mockFullPath.value } });
  });
});

// ---------------------------------------------------------------------------
// Stale enrollment (regression): the server already lists this device as
// enrolled (found via GET /pak/devices — reaching the 'ready' UI proves this),
// but the local Keystore alias / localStorage marker is gone (e.g. app data
// was cleared or reinstalled). Approve used to mislabel this "not enrolled"
// and send the user to Settings, where the exact same local-state gate hid
// any way to fix it. It must now surface as a distinct, self-service state.
// ---------------------------------------------------------------------------
describe('pak/approve page — stale enrollment (regression)', () => {
  const VALID_QR_PARAM = btoa(JSON.stringify({ s: 'session-abc', p: 'ZGVza3RvcC1wdWJrZXk=', c: '00'.repeat(32) }));
  const SERVER_DEVICE = {
    id: 'server-row-77',
    deviceName: 'My Phone',
    platform: 'android',
    enrollmentMethod: 'master_password',
    enrolledAt: '2026-06-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    publicKeyFingerprint: 'fp-1',
  };

  beforeEach(() => {
    mockRouteQuery.value = { d: VALID_QR_PARAM };
    localStorage.clear();
  });

  async function mountReady(apiFetchImpl: (path: string, opts?: unknown) => unknown) {
    const auth = useAuthStore();
    auth.user = { id: 'user-1', email: 'a@b.com', kdfSalt: 'aa'.repeat(32), totpEnabled: false };
    const apiFetchSpy = vi.spyOn(auth, 'apiFetch').mockImplementation(apiFetchImpl as never);

    const wrapper = mount(ApprovePage, { global: { stubs } });
    await flushPromises();
    return { wrapper, apiFetchSpy };
  }

  function clickButtonWithText(wrapper: ReturnType<typeof mount>, text: string) {
    const button = wrapper.findAll('button').find((b) => b.text() === text);
    if (!button) throw new Error(`Button with text "${text}" not found`);
    return button.trigger('click');
  }

  it('shows a distinct "stale enrollment" state (not the generic "not enrolled" message) when localStorage has no marker', async () => {
    const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
    const { wrapper } = await mountReady(async (path: string) => {
      if (path === '/pak/devices') return [SERVER_DEVICE];
      return undefined;
    });

    // Reached 'ready' — server enrollment was found
    expect(wrapper.text()).not.toContain('Device not enrolled');

    await clickButtonWithText(wrapper, 'Approve');
    await flushPromises();

    expect(wrapper.text()).toContain('Stale enrollment');
    expect(wrapper.text()).not.toContain('Device not enrolled');
    // Never got as far as touching the Keystore — localStorage marker was the gate
    expect(AdytonKeystore.hasKeys).not.toHaveBeenCalled();
  });

  it('also lands on stale-enrollment when the localStorage marker exists but the Keystore keys are gone', async () => {
    localStorage.setItem('adyton_pak_device_user-1', 'orphaned-local-id');
    const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
    (AdytonKeystore.hasKeys as ReturnType<typeof vi.fn>).mockResolvedValue({ exists: false });

    const { wrapper } = await mountReady(async (path: string) => {
      if (path === '/pak/devices') return [SERVER_DEVICE];
      return undefined;
    });

    await clickButtonWithText(wrapper, 'Approve');
    await flushPromises();

    expect(wrapper.text()).toContain('Stale enrollment');
  });

  it('removes the stale enrollment using the server row id (not any local id) and navigates to /settings', async () => {
    const { wrapper, apiFetchSpy } = await mountReady(async (path: string) => {
      if (path === '/pak/devices') return [SERVER_DEVICE];
      return undefined;
    });

    await clickButtonWithText(wrapper, 'Approve');
    await flushPromises();

    await clickButtonWithText(wrapper, 'Remove stale enrollment');
    await flushPromises();

    expect(apiFetchSpy).toHaveBeenCalledWith(
      `/pak/devices/${SERVER_DEVICE.id}?reason=safe`,
      { method: 'DELETE' },
    );
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});
