import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import OtpInput from '../../app/components/OtpInput.vue';

function mountOtp(props: Record<string, unknown> = {}) {
  return mount(OtpInput, { props });
}

describe('OtpInput', () => {
  it('renders `length` boxes (default 6)', () => {
    const w = mountOtp();
    // Boxes are the divs inside the row; the single input is the capture overlay.
    expect(w.findAll('.font-mono')).toHaveLength(6);
    expect(w.find('input').exists()).toBe(true);
  });

  it('respects a custom length', () => {
    const w = mountOtp({ length: 4 });
    expect(w.findAll('.font-mono')).toHaveLength(4);
    expect(w.find('input').attributes('maxlength')).toBe('4');
  });

  it('updates the model and fills boxes as digits are typed', async () => {
    const w = mountOtp();
    await w.find('input').setValue('12');

    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['12']);
    const boxes = w.findAll('.font-mono');
    expect(boxes[0].text()).toBe('1');
    expect(boxes[1].text()).toBe('2');
    expect(boxes[2].text()).toBe('');
  });

  it('filters out non-digit characters', async () => {
    const w = mountOtp();
    await w.find('input').setValue('1a2b3c');

    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['123']);
  });

  it('slices input to `length`', async () => {
    const w = mountOtp({ length: 4 });
    await w.find('input').setValue('1234567');

    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['1234']);
  });

  it('emits complete with the full code when length is reached', async () => {
    const w = mountOtp();
    await w.find('input').setValue('123456');

    expect(w.emitted('complete')).toHaveLength(1);
    expect(w.emitted('complete')![0]).toEqual(['123456']);
  });

  it('does not emit complete before the full length', async () => {
    const w = mountOtp();
    await w.find('input').setValue('12345');
    expect(w.emitted('complete')).toBeUndefined();
  });

  it('emits complete after pasting (typed) the full code at once', async () => {
    const w = mountOtp();
    // setValue mirrors a paste landing in the overlay input in one shot.
    await w.find('input').setValue('987654');
    expect(w.emitted('complete')![0]).toEqual(['987654']);
  });

  it('applies invalid styling to the boxes', () => {
    const w = mountOtp({ invalid: true });
    expect(w.findAll('.font-mono').every((b) => b.classes().includes('border-error/60'))).toBe(true);
  });

  it('sets aria-label and name on the input', () => {
    const w = mountOtp({ ariaLabel: 'Authentication code', name: 'code' });
    const input = w.find('input');
    expect(input.attributes('aria-label')).toBe('Authentication code');
    expect(input.attributes('name')).toBe('code');
  });

  it('marks the active box with the focus ring while focused', async () => {
    const w = mountOtp();
    await w.find('input').setValue('12');
    await w.find('input').trigger('focus');

    const boxes = w.findAll('.font-mono');
    // Active box = next to fill (index 2 after two digits).
    expect(boxes[2].classes()).toContain('ring-2');
    expect(boxes[0].classes()).not.toContain('ring-2');
  });
});
