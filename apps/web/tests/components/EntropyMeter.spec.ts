import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import EntropyMeter from '../../app/components/EntropyMeter.vue';

const STRONG = {
  label: 'Strong',
  badgeClass: 'text-green-400',
  description: 'Would take centuries to crack with current hardware',
};

describe('EntropyMeter', () => {
  it('renders the rounded bits, description, and badge label', () => {
    const w = mount(EntropyMeter, { props: { bits: 82.4, strength: STRONG } });
    expect(w.text()).toContain('~82 bits of entropy');
    expect(w.text()).toContain('centuries');
    expect(w.text()).toContain('Strong');
    expect(w.find('.totp-ring').attributes('style')).toContain('--progress: 82.4%');
  });

  it('caps the ring progress at 100%', () => {
    const w = mount(EntropyMeter, {
      props: { bits: 129.2, strength: { ...STRONG, label: 'Excellent' } },
    });
    expect(w.find('.totp-ring').attributes('style')).toContain('--progress: 100%');
    expect(w.text()).toContain('~129 bits');
  });

  it('renders zero bits without crashing', () => {
    const w = mount(EntropyMeter, {
      props: { bits: 0, strength: { ...STRONG, label: 'Weak', description: 'Too guessable' } },
    });
    expect(w.text()).toContain('~0 bits');
    expect(w.find('.totp-ring').attributes('style')).toContain('--progress: 0%');
  });
});
