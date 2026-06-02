import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BrandLogo from '../../app/components/BrandLogo.vue';

describe('BrandLogo', () => {
  it('renders the wordmark and the masked logo mark', () => {
    const wrapper = mount(BrandLogo);
    expect(wrapper.text()).toContain('Adyton');
    const mark = wrapper.find('[role="img"]');
    expect(mark.attributes('aria-label')).toBe('Adyton');
    expect(mark.classes().join(' ')).toContain('url(/logo.svg)');
  });

  it('renders the tagline only when provided', () => {
    expect(mount(BrandLogo).text()).not.toContain('what matters');
    const wrapper = mount(BrandLogo, {
      props: { tagline: 'Zero-knowledge vault for what matters' },
    });
    expect(wrapper.text()).toContain('Zero-knowledge vault for what matters');
  });

  it('uses larger badge/title for size=lg vs md', () => {
    const lg = mount(BrandLogo, { props: { size: 'lg' } });
    const md = mount(BrandLogo, { props: { size: 'md' } });
    expect(lg.find('h1').classes()).toContain('text-3xl');
    expect(md.find('h1').classes()).toContain('text-2xl');
  });

  it('renders the pulsing halo only when pulse is set', () => {
    expect(mount(BrandLogo).find('.animate-pulse-ring').exists()).toBe(false);
    expect(mount(BrandLogo, { props: { pulse: true } }).find('.animate-pulse-ring').exists()).toBe(true);
  });
});
