import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { VaultEntryType, type DecryptedEntry } from '@adyton/shared';
import VaultEntryModal from '../../app/components/VaultEntryModal.vue';

// Partial-mock: keep the real enum/types (runtime values used by the component) and
// override only generatePassword for determinism.
vi.mock('@adyton/shared', async (importActual) => {
  const actual = await importActual<typeof import('@adyton/shared')>();
  return { ...actual, generatePassword: vi.fn(() => 'GENERATED_PW_20CHARS!') };
});

// USlideover teleports + renders only when open; stub it so the #content slot is always
// in the wrapper tree (model `open` defaults true here).
const USlideoverStub = {
  name: 'USlideover',
  template: '<div class="uslideover"><slot name="content" /></div>',
};
const UFormStub = { name: 'UForm', props: ['state'], template: '<form class="uform"><slot /></form>' };
const UFormFieldStub = {
  name: 'UFormField',
  props: ['label', 'name', 'required'],
  template: '<div class="ufield" :data-name="name"><slot name="label" />{{ label }}<slot /><slot name="help" /></div>',
};
const UInputStub = {
  name: 'UInput',
  props: ['modelValue', 'type', 'placeholder'],
  emits: ['update:modelValue'],
  template:
    '<input class="uinput" :data-placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const UTextareaStub = {
  name: 'UTextarea',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  template:
    '<textarea class="utextarea" :data-placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const USelectStub = {
  name: 'USelect',
  props: ['modelValue', 'items'],
  emits: ['update:modelValue'],
  template: '<select class="uselect" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)" />',
};
const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'disabled', 'ariaLabel'],
  emits: ['click'],
  template:
    '<button class="ubutton" :data-icon="icon" :aria-label="ariaLabel" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
};
const UIconStub = { name: 'UIcon', props: ['name'], template: '<i :data-icon="name" />' };
// Real PasswordInput is fine but pulls more stubs; stub it to a plain input bound to v-model.
const PasswordInputStub = {
  name: 'PasswordInput',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  template:
    '<input class="pwinput" :data-placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

function mountModal(props: Record<string, unknown> = {}) {
  return mount(VaultEntryModal, {
    props: { modelValue: true, 'onUpdate:modelValue': () => {}, ...props },
    global: {
      stubs: {
        USlideover: USlideoverStub,
        UForm: UFormStub,
        UFormField: UFormFieldStub,
        UInput: UInputStub,
        UTextarea: UTextareaStub,
        USelect: USelectStub,
        UButton: UButtonStub,
        UIcon: UIconStub,
        PasswordInput: PasswordInputStub,
      },
    },
  });
}

/** Find a UFormField by its `name` and return whether it is rendered. */
function hasField(w: ReturnType<typeof mountModal>, name: string): boolean {
  return w.findAll('.ufield').some((f) => f.attributes('data-name') === name);
}

/** The Generate / Save / Cancel buttons (stubbed UButton) by text. */
function buttonByText(w: ReturnType<typeof mountModal>, text: string) {
  return w.findAll('.ubutton').find((b) => b.text().includes(text));
}

/** A type-selector chip (raw <button>) by its exact label text. */
function typeChip(w: ReturnType<typeof mountModal>, label: string) {
  return w.findAll('button').find((b) => b.text().trim() === label);
}

describe('VaultEntryModal', () => {
  it('renders ADD mode with LOGIN fields by default', () => {
    const w = mountModal();
    expect(w.text()).toContain('New Login Entry');
    expect(hasField(w, 'label')).toBe(true);
    expect(hasField(w, 'url')).toBe(true);
    expect(hasField(w, 'username')).toBe(true);
    expect(hasField(w, 'password')).toBe(true);
    expect(hasField(w, 'totpSecret')).toBe(true);
    // No env-file/secret fields in LOGIN.
    expect(hasField(w, 'envContent')).toBe(false);
    expect(hasField(w, 'secretKey')).toBe(false);
  });

  it('switching type to ENV_FILE swaps the visible fields', async () => {
    const w = mountModal();
    const envBtn = typeChip(w, 'Env File');
    expect(envBtn).toBeTruthy();
    await envBtn!.trigger('click');
    expect(hasField(w, 'envContent')).toBe(true);
    expect(hasField(w, 'environment')).toBe(true);
    // LOGIN-only fields are gone.
    expect(hasField(w, 'username')).toBe(false);
    expect(hasField(w, 'password')).toBe(false);
  });

  it('EDIT mode prefills fields and locks the type selector', () => {
    const entry: DecryptedEntry = {
      id: 'e1',
      type: VaultEntryType.SECRET,
      label: 'Stripe',
      createdAt: new Date(),
      updatedAt: new Date(),
      secretVersion: 2,
      environment: 'production',
      secretKey: 'STRIPE_KEY',
      secretValue: 'sk_live_abc',
    };
    const w = mountModal({ entry });
    expect(w.text()).toContain('Edit Secret Entry');
    // Prefilled key value present on the input.
    const keyInput = w.findAll('.uinput').find((i) => i.attributes('data-placeholder') === 'STRIPE_API_KEY');
    expect(keyInput?.element.value).toBe('STRIPE_KEY');
    // Type chips are disabled in edit mode.
    const loginChip = typeChip(w, 'Login');
    expect(loginChip?.attributes('disabled')).toBeDefined();
  });

  it('blocks Save when the label is empty', async () => {
    const w = mountModal();
    const saveBtn = buttonByText(w, 'Save Entry');
    expect(saveBtn?.attributes('disabled')).toBeDefined();
    await saveBtn!.trigger('click');
    expect(w.emitted('save')).toBeFalsy();
  });

  it('emits a correctly scoped EntryDraft for a LOGIN entry on Save', async () => {
    const w = mountModal();
    // Fill label + username + password.
    await w.find('input[data-placeholder="e.g. GitHub"]').setValue('GitHub');
    await w.find('input[data-placeholder="alice@example.com"]').setValue('octocat');
    await w.find('input[data-placeholder="••••••••••••"]').setValue('hunter2');

    const saveBtn = buttonByText(w, 'Save Entry');
    expect(saveBtn?.attributes('disabled')).toBeUndefined();
    await saveBtn!.trigger('click');

    const payload = w.emitted('save')?.[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: VaultEntryType.LOGIN,
      label: 'GitHub',
      username: 'octocat',
      password: 'hunter2',
    });
    // Empty fields are omitted, and no cross-type fields leak in.
    expect(payload).not.toHaveProperty('url');
    expect(payload).not.toHaveProperty('secretKey');
    expect(payload).not.toHaveProperty('envContent');
    expect(payload).not.toHaveProperty('environment');
  });

  it('does not leak stale fields when switching type before Save', async () => {
    const w = mountModal();
    // Type a password under LOGIN, then switch to SECURE_NOTE.
    await w.find('input[data-placeholder="••••••••••••"]').setValue('leaky-secret');
    await typeChip(w, 'Note')!.trigger('click');
    await w.find('input[data-placeholder="e.g. GitHub"]').setValue('My note');
    await buttonByText(w, 'Save Entry')!.trigger('click');

    const payload = w.emitted('save')?.[0]?.[0] as Record<string, unknown>;
    expect(payload.type).toBe(VaultEntryType.SECURE_NOTE);
    expect(payload).not.toHaveProperty('password');
  });

  it('Generate button populates the password field', async () => {
    const w = mountModal();
    await w.find('input[data-placeholder="e.g. GitHub"]').setValue('GitHub');
    await buttonByText(w, 'Generate')!.trigger('click');
    await buttonByText(w, 'Save Entry')!.trigger('click');

    const payload = w.emitted('save')?.[0]?.[0] as Record<string, unknown>;
    expect(payload.password).toBe('GENERATED_PW_20CHARS!');
  });

  it('Cancel closes without emitting save', async () => {
    const w = mountModal();
    await buttonByText(w, 'Cancel')!.trigger('click');
    expect(w.emitted('save')).toBeFalsy();
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });
});
