import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const listVersions = vi.fn();
const restoreVersion = vi.fn();

vi.mock('~/stores/vault', () => ({
  useVaultStore: () => ({ listVersions, restoreVersion }),
}));

import VersionHistory from '../../app/components/VersionHistory.vue';

const UModalStub = {
  name: 'UModal',
  props: ['open'],
  template: '<div class="umodal"><slot name="body" /></div>',
};
const USkeletonStub = { name: 'USkeleton', template: '<div class="uskeleton" />' };
const UButtonStub = {
  name: 'UButton',
  props: ['label', 'loading'],
  emits: ['click'],
  template: '<button class="ubtn" @click="$emit(\'click\', $event)">{{ label }}</button>',
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

function mountHistory() {
  return mount(VersionHistory, {
    props: { modelValue: false, entryId: 'e1' },
    global: { stubs: { UModal: UModalStub, USkeleton: USkeletonStub, UButton: UButtonStub } },
  });
}

describe('VersionHistory', () => {
  it('loads versions when opened and lists them newest-first', async () => {
    const w = mountHistory();
    expect(listVersions).not.toHaveBeenCalled();
    await w.setProps({ modelValue: true });
    await flushPromises();
    expect(listVersions).toHaveBeenCalledWith('e1');
    expect(w.text()).toContain('v3');
    expect(w.text()).toContain('v2');
  });

  it('restores a version and emits the restored entry', async () => {
    const w = mountHistory();
    await w.setProps({ modelValue: true });
    await flushPromises();
    await w.findAll('.ubtn').find((b) => b.text() === 'Restore')!.trigger('click');
    await flushPromises();
    expect(restoreVersion).toHaveBeenCalledWith('e1', 'ver-3');
    expect(w.emitted('restored')?.[0]).toEqual([{ id: 'e1', label: 'GitHub' }]);
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('shows an empty state when there are no versions', async () => {
    listVersions.mockResolvedValue([]);
    const w = mountHistory();
    await w.setProps({ modelValue: true });
    await flushPromises();
    expect(w.text().toLowerCase()).toContain('no previous versions');
  });
});
