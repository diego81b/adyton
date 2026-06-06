import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch }),
}));

import TrustedDevicesCard from '../../app/components/TrustedDevicesCard.vue';

const DEVICES = [
  {
    id: 'd1',
    deviceIdHash: 'abc',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0',
    ipAddress: '198.51.100.7',
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

const UButtonStub = {
  name: 'UButton',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>',
};
const ConfirmDialogStub = {
  name: 'ConfirmDialog',
  props: ['open', 'title', 'message', 'confirmLabel', 'loading'],
  emits: ['update:open', 'confirm'],
  template: '<div v-if="open" class="confirm" />',
};

function mountCard() {
  return mount(TrustedDevicesCard, {
    global: {
      stubs: { UButton: UButtonStub, UIcon: true, ConfirmDialog: ConfirmDialogStub },
    },
  });
}

beforeEach(() => {
  mockApiFetch.mockReset();
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});

describe('TrustedDevicesCard', () => {
  it('loads and renders trusted devices', async () => {
    mockApiFetch.mockResolvedValueOnce(DEVICES);
    const w = mountCard();
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/devices');
    expect(w.text()).toContain('1 trusted');
    expect(w.text()).toContain('Firefox · Linux');
  });

  it('revokes trust after confirmation', async () => {
    mockApiFetch.mockResolvedValueOnce(DEVICES);
    mockApiFetch.mockResolvedValueOnce(undefined);
    const w = mountCard();
    await flushPromises();

    await w.findAll('button').find((b) => b.text() === 'Revoke')!.trigger('click');
    w.findComponent(ConfirmDialogStub).vm.$emit('confirm');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/devices/d1', { method: 'DELETE' });
    expect(w.text()).toContain('No trusted devices');
  });

  it('shows the empty state', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    const w = mountCard();
    await flushPromises();
    expect(w.text()).toContain('No trusted devices');
  });
});
