// Regression tests for the boot-redirect on app entry (pages/index.vue).
// Bug: the page unconditionally forced /login, discarding a still-valid session
// (refresh cookie) on every cold mobile app start and bypassing the /unlock page's
// existing auto-biometric flow.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { onMounted } from 'vue';

const { useAuthStore } = await import('../../app/stores/auth');

const mockReplace = vi.fn();
vi.stubGlobal('useRouter', () => ({ replace: mockReplace }));
vi.stubGlobal('definePageMeta', vi.fn());
vi.stubGlobal('onMounted', onMounted);

import IndexPage from '../../app/pages/index.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockReplace.mockResolvedValue(undefined);
});

describe('index page — boot redirect', () => {
  it('redirects to /vault when a valid session already exists', async () => {
    const auth = useAuthStore();
    vi.spyOn(auth, 'initialize').mockResolvedValue(true);

    mount(IndexPage);
    await flushPromises();

    expect(auth.initialize).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/vault');
  });

  it('redirects to /login when there is no valid session', async () => {
    const auth = useAuthStore();
    vi.spyOn(auth, 'initialize').mockResolvedValue(false);

    mount(IndexPage);
    await flushPromises();

    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});
