import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { VaultEntryType } from '@adyton/shared';
import VaultFilters from '../../app/components/VaultFilters.vue';

const USlideoverStub = {
  name: 'USlideover',
  template: '<div class="uslideover"><slot name="body" /><slot name="footer" /></div>',
};
const UButtonStub = {
  name: 'UButton',
  props: ['label', 'disabled', 'icon'],
  emits: ['click'],
  template:
    '<button class="ubtn" :disabled="disabled" @click="$emit(\'click\', $event)">{{ label }}</button>',
};
const USelectStub = {
  name: 'USelect',
  props: ['modelValue', 'items'],
  emits: ['update:modelValue'],
  template: '<select class="uselect" @change="$emit(\'update:modelValue\', $event.target.value)" />',
};

const counts = { all: 9, [VaultEntryType.LOGIN]: 2, [VaultEntryType.SECRET]: 1 } as Record<
  string,
  number
>;
const envOptions = [
  { value: 'all' as const, label: 'All environments' },
  { value: 'production' as const, label: 'Production' },
];

function mountFilters(props: Record<string, unknown> = {}) {
  return mount(VaultFilters, {
    props: {
      open: true,
      type: 'all',
      environment: 'all',
      counts,
      envOptions,
      ...props,
    },
    global: { stubs: { USlideover: USlideoverStub, UButton: UButtonStub, USelect: USelectStub } },
  });
}

describe('VaultFilters', () => {
  it('renders the All chip plus one chip per entry type', () => {
    const w = mountFilters();
    const chips = w.findAll('button.rounded-full');
    expect(chips).toHaveLength(1 + 6); // All + 6 types
    expect(w.text()).toContain('All');
    expect(w.text()).toContain('Login');
  });

  it('emits update:type when a type chip is clicked', async () => {
    const w = mountFilters();
    await w.findAll('button.rounded-full').find((b) => b.text().includes('Login'))!.trigger('click');
    expect(w.emitted('update:type')?.at(-1)).toEqual([VaultEntryType.LOGIN]);
  });

  it('Reset is disabled with no active filters and clears both when active', async () => {
    const none = mountFilters();
    const resetNone = none.findAll('.ubtn').find((b) => b.text() === 'Reset')!;
    expect((resetNone.element as HTMLButtonElement).disabled).toBe(true);

    const active = mountFilters({ type: VaultEntryType.LOGIN, environment: 'production' });
    const reset = active.findAll('.ubtn').find((b) => b.text() === 'Reset')!;
    expect((reset.element as HTMLButtonElement).disabled).toBe(false);
    await reset.trigger('click');
    expect(active.emitted('update:type')?.at(-1)).toEqual(['all']);
    expect(active.emitted('update:environment')?.at(-1)).toEqual(['all']);
  });

  it('Done closes the slideover', async () => {
    const w = mountFilters();
    await w.findAll('.ubtn').find((b) => b.text() === 'Done')!.trigger('click');
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('shows the environment filter for all / ENV_FILE / SECRET', () => {
    expect(mountFilters({ type: 'all' }).find('.uselect').exists()).toBe(true);
    expect(mountFilters({ type: VaultEntryType.ENV_FILE }).find('.uselect').exists()).toBe(true);
    expect(mountFilters({ type: VaultEntryType.SECRET }).find('.uselect').exists()).toBe(true);
  });

  it('hides the environment filter for types that never carry an environment', () => {
    expect(mountFilters({ type: VaultEntryType.LOGIN }).find('.uselect').exists()).toBe(false);
    expect(mountFilters({ type: VaultEntryType.CREDIT_CARD }).find('.uselect').exists()).toBe(false);
  });

  it('clears an active environment when switching to a non-env type', async () => {
    const w = mountFilters({ type: VaultEntryType.ENV_FILE, environment: 'production' });
    await w.setProps({ type: VaultEntryType.LOGIN });
    expect(w.emitted('update:environment')?.at(-1)).toEqual(['all']);
  });
});
