import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch }),
}));

import SessionsCard from '../../app/components/SessionsCard.vue';

const SESSIONS = [
  {
    id: 's1',
    familyId: 'f1',
    ipAddress: '192.0.2.14',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
  {
    id: 's2',
    familyId: 'f2',
    ipAddress: '203.0.113.92',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/605.1',
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
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
  template: '<div v-if="open" class="confirm" :data-title="title" />',
};

function mountCard() {
  return mount(SessionsCard, {
    global: {
      stubs: { UButton: UButtonStub, UIcon: true, ConfirmDialog: ConfirmDialogStub },
    },
  });
}

beforeEach(() => {
  mockApiFetch.mockReset();
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});

describe('SessionsCard', () => {
  it('loads and renders the sessions with parsed user agents', async () => {
    mockApiFetch.mockResolvedValueOnce(SESSIONS);
    const w = mountCard();
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/sessions');
    expect(w.text()).toContain('2 active');
    expect(w.text()).toContain('Chrome · Windows');
    expect(w.text()).toContain('Safari · iOS');
    expect(w.text()).toContain('192.0.2.14');
  });

  it('revokes a session after confirmation and removes the row', async () => {
    mockApiFetch.mockResolvedValueOnce(SESSIONS); // load
    mockApiFetch.mockResolvedValueOnce(undefined); // delete
    const w = mountCard();
    await flushPromises();

    await w.findAll('button').find((b) => b.text() === 'Revoke')!.trigger('click');
    const dialog = w.findComponent(ConfirmDialogStub);
    expect(dialog.props('open')).toBe(true);

    dialog.vm.$emit('confirm');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/sessions/s1', { method: 'DELETE' });
    expect(w.text()).toContain('1 active');
  });

  it('revoke-all deletes every session sequentially', async () => {
    mockApiFetch.mockResolvedValueOnce(SESSIONS);
    mockApiFetch.mockResolvedValue(undefined);
    const w = mountCard();
    await flushPromises();

    await w.findAll('button').find((b) => b.text().includes('Revoke all'))!.trigger('click');
    const dialogs = w.findAllComponents(ConfirmDialogStub);
    dialogs[1]!.vm.$emit('confirm');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/sessions/s1', { method: 'DELETE' });
    expect(mockApiFetch).toHaveBeenCalledWith('/sessions/s2', { method: 'DELETE' });
    expect(w.text()).toContain('No active sessions');
  });

  it('shows the empty state', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    const w = mountCard();
    await flushPromises();
    expect(w.text()).toContain('No active sessions');
  });

  it('caps the visible list at 5 and shows an overflow note', async () => {
    const manySessions = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i + 1}`,
      familyId: `f${i + 1}`,
      ipAddress: `192.0.2.${i + 1}`,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    mockApiFetch.mockResolvedValueOnce(manySessions);
    const w = mountCard();
    await flushPromises();

    // Count badge shows total; list shows only 5 rows.
    expect(w.text()).toContain('6 active');
    expect(w.findAll('[aria-label]').length).toBe(5);
    expect(w.text()).toContain('Showing 5 of 6 sessions');
  });
});
