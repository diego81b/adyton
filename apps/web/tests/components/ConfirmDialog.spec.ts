import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmDialog from '../../app/components/ConfirmDialog.vue';

const UModalStub = {
  name: 'UModal',
  props: ['open', 'title'],
  template: '<div class="umodal"><slot name="content" /></div>',
};
const UButtonStub = {
  name: 'UButton',
  props: ['loading', 'color'],
  emits: ['click'],
  template: '<button :data-color="color" @click="$emit(\'click\')"><slot /></button>',
};
const UIconStub = { name: 'UIcon', props: ['name'], template: '<i />' };

function mountDialog() {
  return mount(ConfirmDialog, {
    props: {
      open: true,
      title: 'Revoke session?',
      message: 'The device will be signed out.',
      confirmLabel: 'Revoke',
    },
    global: { stubs: { UModal: UModalStub, UButton: UButtonStub, UIcon: UIconStub } },
  });
}

describe('ConfirmDialog', () => {
  it('renders title, message, and confirm label', () => {
    const w = mountDialog();
    expect(w.text()).toContain('Revoke session?');
    expect(w.text()).toContain('The device will be signed out.');
    expect(w.text()).toContain('Revoke');
  });

  it('emits confirm on the destructive button', async () => {
    const w = mountDialog();
    await w.find('button[data-color="error"]').trigger('click');
    expect(w.emitted('confirm')).toHaveLength(1);
  });

  it('closes via the cancel button without confirming', async () => {
    const w = mountDialog();
    await w.find('button[data-color="neutral"]').trigger('click');
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
    expect(w.emitted('confirm')).toBeUndefined();
  });
});
