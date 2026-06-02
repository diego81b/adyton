import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AuthCard from '../../app/components/AuthCard.vue';

describe('AuthCard', () => {
  it('renders slot content in a themed translucent card', () => {
    const wrapper = mount(AuthCard, { slots: { default: '<span class="x">hi</span>' } });
    expect(wrapper.find('.x').text()).toBe('hi');
    const root = wrapper.find('div');
    expect(root.classes()).toEqual(
      expect.arrayContaining(['rounded-2xl', 'border', 'border-default', 'backdrop-blur']),
    );
  });
});
