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

function chip(w: ReturnType<typeof mountFilters>, label: string) {
  return w.findAll('button.rounded-full').find((b) => b.text().includes(label))!;
}
function footerBtn(w: ReturnType<typeof mountFilters>, label: string) {
  return w.findAll('.ubtn').find((b) => b.text() === label)!;
}

describe('VaultFilters — draft semantics (apply on Done)', () => {
  it('renders the All chip plus one chip per entry type', () => {
    const w = mountFilters();
    const chips = w.findAll('button.rounded-full');
    expect(chips).toHaveLength(1 + 6); // All + 6 types
    expect(w.text()).toContain('All');
    expect(w.text()).toContain('Login');
  });

  it('clicking a chip does NOT emit update:type until Done', async () => {
    const w = mountFilters();
    await chip(w, 'Login').trigger('click');
    expect(w.emitted('update:type')).toBeUndefined(); // draft only

    await footerBtn(w, 'Done').trigger('click');
    expect(w.emitted('update:type')?.at(-1)).toEqual([VaultEntryType.LOGIN]);
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('closing without Done discards the draft (reopens from applied values)', async () => {
    const w = mountFilters();
    await chip(w, 'Secret').trigger('click');
    // Close without Done (backdrop/X), then reopen.
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await footerBtn(w, 'Done').trigger('click');
    // Draft was re-seeded from the applied 'all', so applying changes nothing —
    // defineModel emits no update for an unchanged value. The abandoned 'SECRET'
    // draft never leaked out.
    expect(w.emitted('update:type')).toBeUndefined();
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('Reset clears the draft; nothing applies until Done', async () => {
    const w = mountFilters({ type: VaultEntryType.LOGIN, environment: 'all' });
    const reset = footerBtn(w, 'Reset');
    expect((reset.element as HTMLButtonElement).disabled).toBe(false);
    await reset.trigger('click');
    expect(w.emitted('update:type')).toBeUndefined();
    await footerBtn(w, 'Done').trigger('click');
    expect(w.emitted('update:type')?.at(-1)).toEqual(['all']);
  });

  it('Reset is disabled when the draft has no active filters', () => {
    const w = mountFilters();
    expect((footerBtn(w, 'Reset').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the environment filter for all / ENV_FILE / SECRET drafts', async () => {
    const w = mountFilters();
    expect(w.find('.uselect').exists()).toBe(true);
    await chip(w, 'Env File').trigger('click');
    expect(w.find('.uselect').exists()).toBe(true);
    await chip(w, 'Secret').trigger('click');
    expect(w.find('.uselect').exists()).toBe(true);
  });

  it('hides the environment filter when the draft type never carries one', async () => {
    const w = mountFilters();
    await chip(w, 'Login').trigger('click');
    expect(w.find('.uselect').exists()).toBe(false);
  });

  it('switching the draft to a non-env type clears the draft environment', async () => {
    const w = mountFilters({ type: VaultEntryType.ENV_FILE, environment: 'production' });
    await chip(w, 'Login').trigger('click');
    await footerBtn(w, 'Done').trigger('click');
    expect(w.emitted('update:type')?.at(-1)).toEqual([VaultEntryType.LOGIN]);
    expect(w.emitted('update:environment')?.at(-1)).toEqual(['all']);
  });
});
