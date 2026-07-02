// Regression tests for post-login redirect handling (login.vue).
// Bug: completeLogin() hardcoded '/vault', dropping any deep-link destination
// (e.g. /pak/enroll?d=...) the user was bounced away from before authenticating.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

const mockAuthenticateWithPasskey = vi.fn();
vi.mock('../../app/composables/useWebAuthn', () => ({
  useWebAuthn: () => ({ authenticateWithPasskey: mockAuthenticateWithPasskey }),
}));

const { useAuthStore } = await import('../../app/stores/auth');
const { useCryptoStore } = await import('../../app/stores/crypto');

const mockPush = vi.fn();
const mockRedirectQuery = ref<string | undefined>(undefined);
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ query: { redirect: mockRedirectQuery.value } }),
}));
vi.stubGlobal('definePageMeta', vi.fn());

const passthrough = (name: string) => ({ name, template: '<div><slot /><slot name="brand" /><slot name="footer" /></div>' });
const stubs = {
  AuthShell: passthrough('AuthShell'),
  AuthCard: passthrough('AuthCard'),
  BrandLogo: passthrough('BrandLogo'),
  TwoFactorChallenge: { name: 'TwoFactorChallenge', template: '<div class="mfa" />' },
  UForm: {
    name: 'UForm',
    emits: ['submit'],
    template: '<form @submit.prevent="$emit(\'submit\', { preventDefault() {} })"><slot /></form>',
  },
  UFormField: passthrough('UFormField'),
  UAlert: { name: 'UAlert', props: ['description'], template: '<div class="ualert">{{ description }}</div>' },
  UButton: {
    name: 'UButton',
    props: ['disabled', 'type'],
    template: '<button :type="type || \'button\'" :disabled="disabled || undefined"><slot /></button>',
  },
  PasswordInput: {
    name: 'PasswordInput',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="password-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  UInput: {
    name: 'UInput',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="email-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  NuxtLink: { name: 'NuxtLink', template: '<a><slot /></a>' },
};

import LoginPage from '../../app/pages/login.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockRedirectQuery.value = undefined;
  mockPush.mockResolvedValue(undefined);
});

async function submitLogin(w: ReturnType<typeof mount>) {
  await w.find('.email-input').setValue('user@example.com');
  await w.find('.password-input').setValue('correct-password');
  await w.find('form').trigger('submit');
  await flushPromises();
}

describe('login page — post-login redirect (regression)', () => {
  it('defaults to /vault when no redirect query is present', async () => {
    const auth = useAuthStore();
    const crypto = useCryptoStore();
    vi.spyOn(auth, 'login').mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', kdfSalt: 'a'.repeat(64), totpEnabled: false },
      accessToken: 'tok',
    } as never);
    vi.spyOn(crypto, 'deriveKey').mockResolvedValue();

    const w = mount(LoginPage, { global: { stubs } });
    await submitLogin(w);

    expect(mockPush).toHaveBeenCalledWith('/vault');
  });

  it('navigates to the preserved redirect target after login (e.g. PAK enroll deep link)', async () => {
    mockRedirectQuery.value = '/pak/enroll?d=eyJzIjoic2VzcyJ9';
    const auth = useAuthStore();
    const crypto = useCryptoStore();
    vi.spyOn(auth, 'login').mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', kdfSalt: 'a'.repeat(64), totpEnabled: false },
      accessToken: 'tok',
    } as never);
    vi.spyOn(crypto, 'deriveKey').mockResolvedValue();

    const w = mount(LoginPage, { global: { stubs } });
    await submitLogin(w);

    expect(mockPush).toHaveBeenCalledWith('/pak/enroll?d=eyJzIjoic2VzcyJ9');
  });

  it('ignores an off-site redirect target and falls back to /vault', async () => {
    mockRedirectQuery.value = '//evil.example.com/phish';
    const auth = useAuthStore();
    const crypto = useCryptoStore();
    vi.spyOn(auth, 'login').mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', kdfSalt: 'a'.repeat(64), totpEnabled: false },
      accessToken: 'tok',
    } as never);
    vi.spyOn(crypto, 'deriveKey').mockResolvedValue();

    const w = mount(LoginPage, { global: { stubs } });
    await submitLogin(w);

    expect(mockPush).toHaveBeenCalledWith('/vault');
  });
});
