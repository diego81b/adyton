import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SettingRow from '../../app/components/SettingRow.vue';

const global = { stubs: { UIcon: true } };

describe('SettingRow', () => {
  it('renders the label and helper', () => {
    const w = mount(SettingRow, {
      props: { label: 'Email', helper: 'Used for sign-in' },
      global,
    });
    expect(w.text()).toContain('Email');
    expect(w.text()).toContain('Used for sign-in');
  });

  it('shows a plain value as mono + tabular figures when `mono`', () => {
    const w = mount(SettingRow, {
      props: { label: 'IP', value: '10.0.0.1', mono: true },
      global,
    });
    const v = w.find('span.font-mono');
    expect(v.exists()).toBe(true);
    expect(v.text()).toBe('10.0.0.1');
    expect(v.classes()).toContain('tabular-nums');
  });

  it('renders a status dot from the `dot` prop', () => {
    const w = mount(SettingRow, { props: { label: 'X', dot: 'bg-success' }, global });
    expect(w.find('span.bg-success').exists()).toBe(true);
  });

  it('the #action slot replaces the default value', () => {
    const w = mount(SettingRow, {
      props: { label: 'X', value: 'fallback' },
      slots: { action: '<button>Do</button>' },
      global,
    });
    expect(w.find('button').text()).toBe('Do');
    expect(w.text()).not.toContain('fallback');
  });

  it('stacks the action to full width on mobile and rows it from sm up', () => {
    const w = mount(SettingRow, { props: { label: 'X' }, global });
    const root = w.find('div');
    // Mobile: column layout so the action drops to its own full-width line.
    expect(root.classes()).toContain('flex-col');
    expect(root.classes()).toContain('sm:flex-row');
    // The action wrapper is full-width on mobile, natural width from sm up.
    const action = w.findAll('div').find((d) => d.classes().includes('sm:w-auto'));
    expect(action).toBeDefined();
    expect(action!.classes()).toContain('w-full');
  });
});
