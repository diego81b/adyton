import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AuthShell from '../../app/components/AuthShell.vue';

describe('AuthShell', () => {
  it('renders default slot content inside the glow backdrop', () => {
    const wrapper = mount(AuthShell, {
      slots: { default: '<p class="card">body</p>' },
    });
    expect(wrapper.find('.radial-glow').exists()).toBe(true);
    expect(wrapper.find('.card').text()).toBe('body');
  });

  it('always renders the desktop brand panel with trust points and compliance row', () => {
    const wrapper = mount(AuthShell, { slots: { default: 'x' } });
    const aside = wrapper.find('aside');
    expect(aside.exists()).toBe(true);
    // Hidden below lg — the panel is desktop-only; mobile keeps the single column.
    expect(aside.classes()).toContain('hidden');
    expect(aside.classes()).toContain('lg:flex');
    expect(aside.text()).toContain('Adyton');
    expect(aside.text()).toContain('Zero-knowledge · End-to-end encrypted · Self-hosted');
    expect(aside.findAll('li')).toHaveLength(3);
  });

  it('renders brand and footer slots only when provided', () => {
    const without = mount(AuthShell, { slots: { default: 'x' } });
    expect(without.find('main .font-mono').exists()).toBe(false);

    const withSlots = mount(AuthShell, {
      slots: { default: 'x', brand: '<div class="brand">b</div>', footer: 'badge text' },
    });
    // Brand slot is mobile-only: wrapped in lg:hidden (the desktop panel replaces it).
    expect(withSlots.find('.lg\\:hidden .brand').exists()).toBe(true);
    expect(withSlots.find('main .font-mono').text()).toContain('badge text');
  });

  it('uses max-w-md by default and max-w-lg when width=lg', () => {
    expect(
      mount(AuthShell, { slots: { default: 'x' } })
        .find('.max-w-md')
        .exists(),
    ).toBe(true);
    expect(
      mount(AuthShell, { props: { width: 'lg' }, slots: { default: 'x' } })
        .find('.max-w-lg')
        .exists(),
    ).toBe(true);
  });

  it('supports per-page headline override on the brand panel', () => {
    const wrapper = mount(AuthShell, {
      props: { headline: 'Custom headline.' },
      slots: { default: 'x' },
    });
    expect(wrapper.find('aside h1').text()).toBe('Custom headline.');
  });
});
