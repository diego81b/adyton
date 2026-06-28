import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SettingsGroup from '../../app/components/SettingsGroup.vue';

describe('SettingsGroup', () => {
  it('renders the title and the default slot content', () => {
    const w = mount(SettingsGroup, {
      props: { title: 'Account' },
      slots: { default: '<div class="row">r</div>' },
    });
    expect(w.find('h2').text()).toContain('Account');
    expect(w.find('.row').exists()).toBe(true);
  });

  it('renders an inline subtitle', () => {
    const w = mount(SettingsGroup, { props: { title: 'Sessions', subtitle: '3 active' } });
    expect(w.text()).toContain('3 active');
  });

  it('uses error-toned heading in the danger variant', () => {
    const w = mount(SettingsGroup, { props: { title: 'Danger zone', danger: true } });
    expect(w.find('h2').classes()).toContain('text-error');
  });

  it('wraps content in a single hairline, divided container', () => {
    const w = mount(SettingsGroup, { props: { title: 'X' } });
    const container = w.find('h2 + div');
    expect(container.classes()).toContain('divide-y');
    expect(container.classes()).toContain('border');
  });
});
