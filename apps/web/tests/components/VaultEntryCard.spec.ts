import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { VaultEntryType, type DecryptedEntry } from '@adyton/shared';
import VaultEntryCard from '../../app/components/VaultEntryCard.vue';

const UIconStub = { name: 'UIcon', props: ['name'], template: '<i :data-icon="name" />' };
const UBadgeStub = { name: 'UBadge', props: ['color'], template: '<span class="ubadge" :data-color="color"><slot /></span>' };
const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'ariaLabel'],
  emits: ['click'],
  template: '<button class="ucopy" :data-icon="icon" @click="$emit(\'click\', $event)" />',
};

function entry(partial: Partial<DecryptedEntry> & { type: VaultEntryType }): DecryptedEntry {
  return { id: 'e1', label: 'GitHub', createdAt: new Date(), updatedAt: new Date(), secretVersion: 1, ...partial };
}

function mountCard(e: DecryptedEntry) {
  return mount(VaultEntryCard, {
    props: { entry: e },
    global: { stubs: { UIcon: UIconStub, UBadge: UBadgeStub, UButton: UButtonStub } },
  });
}

describe('VaultEntryCard', () => {
  it('renders label and subtitle; type is the tile tooltip, not a text badge', () => {
    const w = mountCard(entry({ type: VaultEntryType.LOGIN, label: 'GitHub', username: 'octo' }));
    expect(w.text()).toContain('GitHub');
    expect(w.text()).toContain('octo');
    expect(w.text()).not.toContain('Login'); // redundant text badge dropped
    expect(w.find('[title="Login"]').exists()).toBe(true);
  });

  it('does not render a chevron for non-copy types (whole card opens detail)', () => {
    const w = mountCard(entry({ type: VaultEntryType.SECURE_NOTE, notes: 'x' }));
    expect(w.find('[data-icon="i-lucide-chevron-right"]').exists()).toBe(false);
  });

  it('emits open on click', async () => {
    const w = mountCard(entry({ type: VaultEntryType.LOGIN }));
    await w.trigger('click');
    expect(w.emitted('open')?.[0]).toEqual(['e1']);
  });

  it('shows a copy button for LOGIN and emits copy without bubbling open', async () => {
    const w = mountCard(entry({ type: VaultEntryType.LOGIN, password: 'p' }));
    const btn = w.find('.ucopy');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(w.emitted('copy')).toBeTruthy();
    expect(w.emitted('open')).toBeFalsy();
  });

  it('shows an environment badge when set', () => {
    const w = mountCard(entry({ type: VaultEntryType.SECRET, environment: 'production' }));
    expect(w.text()).toContain('Production');
  });

  it('always shows the version badge, for every type, even at v1', () => {
    const env = mountCard(entry({ type: VaultEntryType.ENV_FILE, secretVersion: 3, envParsed: { A: '1' } }));
    expect(env.text()).toContain('v3');
    const login = mountCard(entry({ type: VaultEntryType.LOGIN, secretVersion: 1 }));
    expect(login.text()).toContain('v1');
    const note = mountCard(entry({ type: VaultEntryType.SECURE_NOTE, secretVersion: 1 }));
    expect(note.text()).toContain('v1');
  });

  it('shows the notes toggle only when the entry has notes', () => {
    const withNotes = mountCard(entry({ type: VaultEntryType.LOGIN, notes: 'rotate quarterly' }));
    expect(withNotes.find('[data-icon="i-lucide-sticky-note"]').exists()).toBe(true);
    const without = mountCard(entry({ type: VaultEntryType.LOGIN }));
    expect(without.find('[data-icon="i-lucide-sticky-note"]').exists()).toBe(false);
  });

  it('toggles the notes expansion without opening the detail', async () => {
    const w = mountCard(entry({ type: VaultEntryType.LOGIN, notes: 'rotate quarterly' }));
    expect(w.find('[data-testid="card-notes"]').exists()).toBe(false);

    await w.find('[data-icon="i-lucide-sticky-note"]').trigger('click');
    const notes = w.find('[data-testid="card-notes"]');
    expect(notes.exists()).toBe(true);
    expect(notes.text()).toContain('rotate quarterly');
    expect(w.emitted('open')).toBeFalsy(); // toggle must not bubble to the card click

    // Clicking inside the expanded notes (reading / selecting text) must not navigate.
    await notes.trigger('click');
    expect(w.emitted('open')).toBeFalsy();

    await w.find('[data-icon="i-lucide-sticky-note"]').trigger('click');
    expect(w.find('[data-testid="card-notes"]').exists()).toBe(false);
  });

  it('does NOT show a copy button for ENV_FILE (no full-file clipboard)', () => {
    const w = mountCard(entry({ type: VaultEntryType.ENV_FILE, envParsed: {} }));
    expect(w.find('.ucopy').exists()).toBe(false);
  });
});
