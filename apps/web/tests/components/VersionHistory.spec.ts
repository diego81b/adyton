import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const listVersions = vi.fn();
const restoreVersion = vi.fn();

vi.mock('~/stores/vault', () => ({
  useVaultStore: () => ({ listVersions, restoreVersion }),
}));

import VersionHistory from '../../app/components/VersionHistory.vue';

const USkeletonStub = { name: 'USkeleton', template: '<div class="uskeleton" />' };
const UButtonStub = {
  name: 'UButton',
  props: ['label', 'loading', 'ariaLabel'],
  emits: ['click'],
  template: '<button class="ubtn" :aria-label="ariaLabel" @click="$emit(\'click\', $event)">{{ label }}<slot /></button>',
};

function version(v: number) {
  return {
    id: `ver-${v}`,
    version: v,
    changeNote: `note ${v}`,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    entry: { id: 'e1', type: 'LOGIN', label: 'GitHub', createdAt: new Date(), updatedAt: new Date(), secretVersion: v },
  };
}

beforeEach(() => {
  listVersions.mockReset().mockResolvedValue([version(3), version(2)]);
  restoreVersion.mockReset().mockResolvedValue({ id: 'e1', label: 'GitHub' });
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

function mountHistory(open = false) {
  return mount(VersionHistory, {
    props: { modelValue: open, entryId: 'e1', version: 3 },
    global: { stubs: { USkeleton: USkeletonStub, UButton: UButtonStub } },
  });
}

describe('VersionHistory', () => {
  it('loads versions on mount (not on open) so expanding is instant', async () => {
    const w = mountHistory();
    await flushPromises();
    expect(listVersions).toHaveBeenCalledWith('e1');
    // Data is ready before the section is even opened.
    await w.setProps({ modelValue: true });
    expect(w.text()).toContain('v3');
    expect(w.text()).toContain('v2');
  });

  it('reloads when the entry version changes (after an edit)', async () => {
    const w = mountHistory(true);
    await flushPromises();
    expect(listVersions).toHaveBeenCalledTimes(1);
    await w.setProps({ version: 4 });
    await flushPromises();
    expect(listVersions).toHaveBeenCalledTimes(2);
  });

  it('restores a version and emits the restored entry, keeping the section open', async () => {
    const w = mountHistory(true);
    await flushPromises();
    await w.findAll('.ubtn').find((b) => b.text() === 'Restore')!.trigger('click');
    await flushPromises();
    expect(restoreVersion).toHaveBeenCalledWith('e1', 'ver-3');
    expect(w.emitted('restored')?.[0]).toEqual([{ id: 'e1', label: 'GitHub' }]);
    // No longer auto-closes — the version watcher refreshes the list in place.
    expect(w.emitted('update:modelValue')).toBeFalsy();
  });

  it('shows an empty state when there are no versions', async () => {
    listVersions.mockResolvedValue([]);
    const w = mountHistory(true);
    await flushPromises();
    expect(w.text().toLowerCase()).toContain('no previous versions');
  });
});
