import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AuthShell from '../../app/components/AuthShell.vue';

describe('AuthShell', () => {
  it('renders default slot content inside the grid backdrop', () => {
    const wrapper = mount(AuthShell, {
      slots: { default: '<p class="card">body</p>' },
    });
    expect(wrapper.find('.bg-grid.radial-glow').exists()).toBe(true);
    expect(wrapper.find('.card').text()).toBe('body');
  });

  it('renders brand and footer slots only when provided', () => {
    const without = mount(AuthShell, { slots: { default: 'x' } });
    expect(without.find('footer, .font-mono').exists()).toBe(false);

    const withSlots = mount(AuthShell, {
      slots: { default: 'x', brand: '<div class="brand">b</div>', footer: 'badge text' },
    });
    expect(withSlots.find('.brand').exists()).toBe(true);
    expect(withSlots.text()).toContain('badge text');
  });

  it('uses max-w-md by default and max-w-5xl when width=5xl', () => {
    expect(mount(AuthShell, { slots: { default: 'x' } }).find('.max-w-md').exists()).toBe(true);
    expect(
      mount(AuthShell, { props: { width: '5xl' }, slots: { default: 'x' } }).find('.max-w-5xl').exists(),
    ).toBe(true);
  });
});
