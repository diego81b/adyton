import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import KeyDerivationStatus from '../../app/components/KeyDerivationStatus.vue';

describe('KeyDerivationStatus', () => {
  it('explains the Argon2id delay', () => {
    const wrapper = mount(KeyDerivationStatus, {
      global: { stubs: { UIcon: true } },
    });
    expect(wrapper.text()).toContain('Deriving encryption key…');
    expect(wrapper.text()).toContain('~1–2 sec for your security');
  });

  it('shows a spinning icon', () => {
    const wrapper = mount(KeyDerivationStatus, {
      global: { stubs: { UIcon: { template: '<i class="icon" :class="$attrs.class" />' } } },
    });
    expect(wrapper.find('.icon').classes()).toContain('animate-spin');
  });
});
