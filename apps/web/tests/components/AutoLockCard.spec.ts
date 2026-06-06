import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../app/composables/useArgon2Worker', () => ({
  useArgon2Worker: vi.fn(),
}));

const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch }),
}));

import AutoLockCard from '../../app/components/AutoLockCard.vue';
const { useSettingsStore } = await import('../../app/stores/settings');

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  mockApiFetch.mockReset();
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});

function mountCard() {
  return mount(AutoLockCard, {
    global: { stubs: { UIcon: true } },
  });
}

describe('AutoLockCard', () => {
  it('marks the active duration and mode from the settings store', () => {
    const w = mountCard();
    const active = w.findAll('button[aria-pressed="true"]');
    expect(active.map((b) => b.text())).toEqual(['15 min', 'On inactivity']);
  });

  it('persists a duration change and re-arms the timer', async () => {
    mockApiFetch.mockResolvedValueOnce({
      displayName: '',
      lockMode: 'activity',
      lockDurationMs: 300_000,
    });
    const w = mountCard();
    const fiveMin = w.findAll('button').find((b) => b.text() === '5 min')!;
    await fiveMin.trigger('click');
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

    expect(mockApiFetch).toHaveBeenCalledWith('/settings', {
      method: 'PUT',
      body: { lockDurationMs: 300_000 },
    });
  });

  it('shows the "never" warning only when duration is 0', async () => {
    const settings = useSettingsStore();
    const w = mountCard();
    expect(w.text()).not.toContain('stays unlocked');
    settings.settings.lockDurationMs = 0;
    await w.vm.$nextTick();
    expect(w.text()).toContain('stays unlocked');
  });

  it('persists a mode change', async () => {
    mockApiFetch.mockResolvedValueOnce({
      displayName: '',
      lockMode: 'absolute',
      lockDurationMs: 900_000,
    });
    const w = mountCard();
    const absolute = w.findAll('button').find((b) => b.text() === 'Fixed interval')!;
    await absolute.trigger('click');
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

    expect(mockApiFetch).toHaveBeenCalledWith('/settings', {
      method: 'PUT',
      body: { lockMode: 'absolute' },
    });
  });
});
