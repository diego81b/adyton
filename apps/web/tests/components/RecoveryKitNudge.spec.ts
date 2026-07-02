import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  }),
}));

import RecoveryKitNudge from '../../app/components/RecoveryKitNudge.vue';

const UButtonStub = {
  name: 'UButton',
  props: ['color', 'variant', 'icon', 'ariaLabel', 'to'],
  emits: ['click'],
  template:
    '<button :aria-label="ariaLabel" :data-to="to" @click="$emit(\'click\')"><slot /></button>',
};

const SettingRowStub = {
  name: 'SettingRow',
  props: ['label', 'helper', 'dot'],
  template: '<div :data-label="label" :data-helper="helper" :data-dot="dot"><slot name="action" /></div>',
};

function mountNudge() {
  return mount(RecoveryKitNudge, {
    global: { stubs: { UButton: UButtonStub, SettingRow: SettingRowStub } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockApiFetch.mockResolvedValue({ hasKit: false });
});

describe('RecoveryKitNudge', () => {
  it('stays hidden while the status check is in flight', () => {
    const wrapper = mountNudge();
    expect(wrapper.find('[data-label]').exists()).toBe(false);
  });

  it('shows the nudge once the status check resolves with no kit', async () => {
    const wrapper = mountNudge();
    await flushPromises();

    expect(wrapper.find('[data-label]').exists()).toBe(true);
    expect(wrapper.find('[data-to="/settings"]').exists()).toBe(true);
  });

  it('stays hidden when a recovery kit already exists', async () => {
    mockApiFetch.mockResolvedValue({ hasKit: true });
    const wrapper = mountNudge();
    await flushPromises();

    expect(wrapper.find('[data-label]').exists()).toBe(false);
  });

  it('stays hidden when the status check fails, rather than nagging on a guess', async () => {
    mockApiFetch.mockRejectedValue(new Error('network error'));
    const wrapper = mountNudge();
    await flushPromises();

    expect(wrapper.find('[data-label]').exists()).toBe(false);
  });

  it('hides immediately on dismiss and stays hidden after remount', async () => {
    const wrapper = mountNudge();
    await flushPromises();
    expect(wrapper.find('[data-label]').exists()).toBe(true);

    await wrapper.find('[aria-label="Dismiss"]').trigger('click');
    expect(wrapper.find('[data-label]').exists()).toBe(false);

    const remounted = mountNudge();
    await flushPromises();
    expect(remounted.find('[data-label]').exists()).toBe(false);
  });
});
