import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

import RecoveryCodesList from '../../app/components/RecoveryCodesList.vue';

const CODES = [
  'aaaaa-bbbbb-ccccc-ddddd',
  'eeeee-fffff-ggggg-hhhhh',
  '11111-22222-33333-44444',
  '55555-66666-77777-88888',
  'aaa11-bbb22-ccc33-ddd44',
  'eee55-fff66-ggg77-hhh88',
  '99999-00000-aaaaa-bbbbb',
  'ccccc-ddddd-eeeee-fffff',
];

const UButtonStub = {
  name: 'UButton',
  props: ['icon'],
  emits: ['click'],
  template: '<button :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
};

const writeText = vi.fn().mockResolvedValue(undefined);

function mountList() {
  return mount(RecoveryCodesList, {
    props: { codes: CODES },
    global: { stubs: { UButton: UButtonStub, UIcon: true } },
  });
}

beforeEach(() => {
  writeText.mockClear();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});

describe('RecoveryCodesList', () => {
  it('renders all 8 codes', () => {
    const w = mountList();
    const cells = w.findAll('code');
    expect(cells).toHaveLength(8);
    expect(w.text()).toContain('aaaaa-bbbbb-ccccc-ddddd');
  });

  it('copy-all writes every code to the clipboard', async () => {
    const w = mountList();
    await w.findAll('button').find((b) => b.text().includes('Copy'))!.trigger('click');
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
  });

  it('download creates a blob anchor and clicks it', async () => {
    const w = mountList();

    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    // Install after mount so Vue's own createElement calls are untouched.
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    await w.findAll('button').find((b) => b.text().includes('Download'))!.trigger('click');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('adyton-recovery-codes.txt');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');

    createElement.mockRestore();
  });
});
