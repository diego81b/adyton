import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const generateTotp = vi.fn(async () => '123456');
const totpRemainingSeconds = vi.fn(() => 30);

vi.mock('@adyton/shared', () => ({
  generateTotp: (...args: unknown[]) => generateTotp(...(args as [])),
  totpRemainingSeconds: (...args: unknown[]) => totpRemainingSeconds(...(args as [])),
}));

import { useTotp } from '../../app/composables/useTotp';

const Host = defineComponent({
  props: { secret: { type: String, default: 'JBSWY3DPEHPK3PXP' } },
  setup(props) {
    return useTotp(() => props.secret);
  },
  template: '<div>{{ code }}/{{ remaining }}/{{ error }}</div>',
});

beforeEach(() => {
  vi.useFakeTimers();
  generateTotp.mockClear().mockResolvedValue('123456');
  totpRemainingSeconds.mockClear().mockReturnValue(30);
});
afterEach(() => vi.useRealTimers());

describe('useTotp', () => {
  it('computes the code on mount', async () => {
    const w = mount(Host);
    await flushPromises();
    expect(generateTotp).toHaveBeenCalled();
    expect(w.vm.code).toBe('123456');
    w.unmount();
  });

  it('does not recompute the code while inside the same 30s period', async () => {
    const w = mount(Host);
    await flushPromises();
    const calls = generateTotp.mock.calls.length;
    // same period counter → tick should not regenerate
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(generateTotp.mock.calls.length).toBe(calls);
    w.unmount();
  });

  it('flips error true when the seed is not valid base32', async () => {
    generateTotp.mockRejectedValueOnce(new Error('bad base32'));
    const w = mount(Host);
    await flushPromises();
    expect(w.vm.error).toBe(true);
    expect(w.vm.code).toBe('');
    w.unmount();
  });

  it('clears the code when the secret is empty', async () => {
    const w = mount(Host, { props: { secret: '' } });
    await flushPromises();
    expect(w.vm.code).toBe('');
    expect(generateTotp).not.toHaveBeenCalled();
    w.unmount();
  });

  it('progress is the REMAINING fraction (ring drains, not fills)', async () => {
    // Non-symmetric value so elapsed-fraction (0.3) and remaining-fraction (0.7)
    // are distinguishable — pins the countdown direction.
    totpRemainingSeconds.mockReturnValue(21);
    const w = mount(Host);
    await flushPromises();
    expect(w.vm.progress()).toBeCloseTo(0.7);
    w.unmount();
  });
});
