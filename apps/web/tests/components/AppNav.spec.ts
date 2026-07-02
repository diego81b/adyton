import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

// useRoute is a Nuxt auto-import (global) in these components.
const route = { path: '/vault' };
vi.stubGlobal('useRoute', () => route);

const mockIsNative = ref(false);
vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: mockIsNative.value }),
}));

const { default: AppSidebar } = await import('../../app/components/AppSidebar.vue');
const { default: AppBottomNav } = await import('../../app/components/AppBottomNav.vue');

beforeEach(() => {
  mockIsNative.value = false;
});

const UIconStub = { name: 'UIcon', props: ['name'], template: '<i :data-icon="name" />' };
const BrandMarkStub = { name: 'BrandMark', template: '<div class="brandmark" />' };
const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: '<a :href="to" :data-to="to" :class="$attrs.class"><slot /></a>',
};

function mountNav(comp: unknown) {
  return mount(comp as never, {
    global: { stubs: { UIcon: UIconStub, BrandMark: BrandMarkStub, NuxtLink: NuxtLinkStub } },
  });
}

describe('AppSidebar', () => {
  it('renders the nav links (environments dropped — folded into in-list filters)', () => {
    const w = mountNav(AppSidebar);
    const links = w.findAll('a').map((a) => a.attributes('data-to'));
    expect(links).toEqual(['/vault', '/generator', '/settings']);
  });

  it('marks the active route with the primary text class', () => {
    route.path = '/vault';
    const w = mountNav(AppSidebar);
    const vaultLink = w.findAll('a').find((a) => a.attributes('data-to') === '/vault')!;
    expect(vaultLink.attributes('class')).toContain('text-primary');
  });

  it('resolves nested routes to their parent nav item', () => {
    route.path = '/vault/abc';
    const w = mountNav(AppSidebar);
    const vaultLink = w.findAll('a').find((a) => a.attributes('data-to') === '/vault')!;
    expect(vaultLink.attributes('class')).toContain('text-primary');
  });

  it('hides the native-only Scan item on web', () => {
    mockIsNative.value = false;
    const w = mountNav(AppSidebar);
    const links = w.findAll('a').map((a) => a.attributes('data-to'));
    expect(links).not.toContain('/scan');
  });

  it('shows the Scan item when native', () => {
    mockIsNative.value = true;
    const w = mountNav(AppSidebar);
    const links = w.findAll('a').map((a) => a.attributes('data-to'));
    expect(links).toEqual(['/vault', '/generator', '/scan', '/settings']);
  });
});

describe('AppBottomNav', () => {
  it('renders the nav links', () => {
    route.path = '/generator';
    const w = mountNav(AppBottomNav);
    expect(w.findAll('a')).toHaveLength(3);
    const gen = w.findAll('a').find((a) => a.attributes('data-to') === '/generator')!;
    expect(gen.attributes('class')).toContain('text-primary');
  });

  it('hides the native-only Scan item on web', () => {
    mockIsNative.value = false;
    const w = mountNav(AppBottomNav);
    const links = w.findAll('a').map((a) => a.attributes('data-to'));
    expect(links).not.toContain('/scan');
  });

  it('shows the Scan item when native', () => {
    mockIsNative.value = true;
    const w = mountNav(AppBottomNav);
    const links = w.findAll('a').map((a) => a.attributes('data-to'));
    expect(links).toEqual(['/vault', '/generator', '/scan', '/settings']);
  });
});
