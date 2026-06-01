import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---- Nuxt stubs ----

const navigateToMock = vi.fn();
vi.stubGlobal('navigateTo', navigateToMock);

// defineNuxtRouteMiddleware: just return the handler so we can call it directly
vi.stubGlobal('defineNuxtRouteMiddleware', (fn: (...args: unknown[]) => unknown) => fn);

// ---- Store mocks (use actual store implementations below) ----
const mockInitialize = vi.fn();
const mockIsUnlocked = { value: false };

vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({
    initialize: mockInitialize,
    accessToken: null,
    user: null,
    isAuthenticated: false,
  }),
}));

vi.mock('../../app/stores/crypto', () => ({
  useCryptoStore: () => ({
    get isUnlocked() { return mockIsUnlocked.value; },
  }),
}));

// Import AFTER mocks
const { default: authMiddleware } = await import('../../app/middleware/auth');

function makeTo(path: string) {
  return { path, matched: [], meta: {}, query: {}, params: {}, hash: '' };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockIsUnlocked.value = false;
});

describe('auth middleware', () => {
  it('does nothing for public routes', async () => {
    mockInitialize.mockResolvedValue(true);
    await authMiddleware(makeTo('/auth/login'), makeTo('/'));
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('does nothing for auth sub-routes', async () => {
    mockInitialize.mockResolvedValue(true);
    await authMiddleware(makeTo('/auth/register'), makeTo('/'));
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('redirects to /auth/login when not authenticated', async () => {
    mockInitialize.mockResolvedValue(false);
    await authMiddleware(makeTo('/vault'), makeTo('/'));
    expect(navigateToMock).toHaveBeenCalledWith('/auth/login');
  });

  it('redirects to /auth/unlock when authenticated but vault locked', async () => {
    mockInitialize.mockResolvedValue(true);
    mockIsUnlocked.value = false;
    await authMiddleware(makeTo('/vault'), makeTo('/'));
    expect(navigateToMock).toHaveBeenCalledWith('/auth/unlock');
  });

  it('does NOT redirect to /auth/unlock when already on /auth/unlock', async () => {
    mockInitialize.mockResolvedValue(true);
    mockIsUnlocked.value = false;
    await authMiddleware(makeTo('/auth/unlock'), makeTo('/vault'));
    // No redirect loop — unlock page is allowed even when vault locked
    expect(navigateToMock).not.toHaveBeenCalledWith('/auth/unlock');
  });

  it('allows /vault access when authenticated and unlocked', async () => {
    mockInitialize.mockResolvedValue(true);
    mockIsUnlocked.value = true;
    await authMiddleware(makeTo('/vault'), makeTo('/'));
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('allows /settings access when authenticated and unlocked', async () => {
    mockInitialize.mockResolvedValue(true);
    mockIsUnlocked.value = true;
    await authMiddleware(makeTo('/settings/security'), makeTo('/'));
    expect(navigateToMock).not.toHaveBeenCalled();
  });
});
