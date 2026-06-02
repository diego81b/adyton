import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PasswordStrengthMeter from '../../app/components/PasswordStrengthMeter.vue';

function mountMeter(props: Record<string, unknown>) {
  return mount(PasswordStrengthMeter, {
    props: {
      score: 0,
      label: 'Strength',
      labelColor: '#64748b',
      bits: 0,
      segColor: '',
      validating: false,
      ...props,
    },
  });
}

describe('PasswordStrengthMeter', () => {
  it('always renders four segments', () => {
    const wrapper = mountMeter({});
    expect(wrapper.findAll('.flex.gap-1\\.5 > div')).toHaveLength(4);
  });

  it('fills segments up to the score with the segment color', () => {
    const wrapper = mountMeter({ score: 3, segColor: '#eab308' });
    const segs = wrapper.findAll('.flex.gap-1\\.5 > div');
    expect(segs[0].attributes('style')).toContain('#eab308');
    expect(segs[2].attributes('style')).toContain('#eab308');
    // 4th segment inactive -> no inline background, uses bg-accented class
    expect(segs[3].classes()).toContain('bg-accented');
    expect(segs[3].attributes('style')).toBeUndefined();
  });

  it('shows the label with its color and the entropy readout', () => {
    const wrapper = mountMeter({ label: 'Strong', labelColor: '#4ade80', bits: 117 });
    expect(wrapper.text()).toContain('Strong');
    expect(wrapper.text()).toContain('117 bits');
    const labelSpan = wrapper.find('span[style]');
    expect(labelSpan.attributes('style')).toContain('#4ade80');
  });

  it('shows "Checking…" while validating instead of the label', () => {
    const wrapper = mountMeter({ validating: true, label: 'Strong' });
    expect(wrapper.text()).toContain('Checking…');
    expect(wrapper.text()).not.toContain('Strong');
  });
});
