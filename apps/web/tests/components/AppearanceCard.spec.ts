import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';
import { mount } from '@vue/test-utils';
import AppearanceCard from '../../app/components/AppearanceCard.vue';

const UIconStub = { name: 'UIcon', props: ['name'], template: '<i :data-icon="name" />' };

function mountCard(preference = 'dark') {
  const colorMode = reactive({ preference, value: preference });
  vi.stubGlobal('useColorMode', () => colorMode);
  const wrapper = mount(AppearanceCard, {
    global: { stubs: { UIcon: UIconStub } },
  });
  return { wrapper, colorMode };
}

describe('AppearanceCard', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the three theme options', () => {
    const { wrapper } = mountCard();
    for (const value of ['system', 'light', 'dark']) {
      expect(wrapper.find(`[data-testid="theme-${value}"]`).exists()).toBe(true);
    }
  });

  it('marks the current preference as pressed', () => {
    const { wrapper } = mountCard('dark');
    expect(wrapper.find('[data-testid="theme-dark"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[data-testid="theme-light"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('[data-testid="theme-system"]').attributes('aria-pressed')).toBe('false');
  });

  it('updates the color-mode preference on click', async () => {
    const { wrapper, colorMode } = mountCard('dark');
    await wrapper.find('[data-testid="theme-light"]').trigger('click');
    expect(colorMode.preference).toBe('light');
    expect(wrapper.find('[data-testid="theme-light"]').attributes('aria-pressed')).toBe('true');
  });

  it('shows the hint for the active option', async () => {
    const { wrapper } = mountCard('system');
    expect(wrapper.text()).toContain('follows your OS preference');
    await wrapper.find('[data-testid="theme-dark"]').trigger('click');
    expect(wrapper.text()).toContain('Blue Whale surfaces, Jet Stream text');
  });
});
