import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Set test API base URL before imports resolve stores
;(globalThis as Record<string, unknown>).__TEST_API_BASE__ = 'http://test-api';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Make useRuntimeConfig unavailable so stores fall back to __TEST_API_BASE__
vi.stubGlobal('useRuntimeConfig', undefined);

// Import AFTER globals are set
const { useAuthStore } = await import('../../app/stores/auth');

function buildAuthResponse(overrides = {}) {
  return {
    accessToken: 'test-access-token',
    user: {
      id: 'user-1',
      email: 'test@example.com',
      kdfSalt: 'a'.repeat(64),
      totpEnabled: false,
    },
    ...overrides,
  };
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

function errorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    statusText: message,
    json: () => Promise.resolve({ message }),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAuthStore — initial state', () => {
  it('starts unauthenticated', () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(store.user).toBeNull();
  });
});

describe('useAuthStore.login', () => {
  it('sets tokens on successful login', async () => {
    const response = buildAuthResponse();
    mockFetch.mockResolvedValueOnce(okResponse(response));

    const store = useAuthStore();
    const result = await store.login('test@example.com', 'password');

    expect(store.isAuthenticated).toBe(true);
    expect(store.accessToken).toBe('test-access-token');
    expect(store.user?.email).toBe('test@example.com');
    expect(store.user?.kdfSalt).toBe('a'.repeat(64));
    expect(result.accessToken).toBe('test-access-token');
  });

  it('sends email and password in POST body', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(buildAuthResponse()));
    const store = useAuthStore();
    await store.login('user@example.com', 'mypass');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('/auth/login');
    expect(callArgs[1].method).toBe('POST');
    const body = JSON.parse(callArgs[1].body);
    expect(body.email).toBe('user@example.com');
    expect(body.password).toBe('mypass');
  });

  it('throws and leaves store unauthenticated on 401', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Invalid credentials'));
    const store = useAuthStore();
    await expect(store.login('bad@user.com', 'wrong')).rejects.toThrow();
    expect(store.isAuthenticated).toBe(false);
  });
});

describe('useAuthStore.register', () => {
  it('sets tokens on successful registration', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(buildAuthResponse()));
    const store = useAuthStore();
    await store.register('new@user.com', 'strongpass');
    expect(store.isAuthenticated).toBe(true);
    expect(store.user?.email).toBe('test@example.com');
  });

  it('calls /auth/register endpoint', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(buildAuthResponse()));
    const store = useAuthStore();
    await store.register('x@y.com', 'p');
    expect(mockFetch.mock.calls[0][0]).toContain('/auth/register');
  });
});

describe('useAuthStore.refresh', () => {
  it('returns true and updates token on success', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(buildAuthResponse({ accessToken: 'new-token' })));
    const store = useAuthStore();
    const ok = await store.refresh();
    expect(ok).toBe(true);
    expect(store.accessToken).toBe('new-token');
  });

  it('returns false and clears store on failure', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));
    const store = useAuthStore();
    store.accessToken = 'old-token'; // set manually
    const ok = await store.refresh();
    expect(ok).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });
});

describe('useAuthStore.initialize', () => {
  it('returns true without fetch if already authenticated', async () => {
    const store = useAuthStore();
    store.accessToken = 'existing-token';
    const ok = await store.initialize();
    expect(ok).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('attempts silent refresh if no token', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(buildAuthResponse()));
    const store = useAuthStore();
    const ok = await store.initialize();
    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/auth/refresh');
  });
});

describe('useAuthStore.logout', () => {
  it('clears store after logout', async () => {
    // Login first
    mockFetch.mockResolvedValueOnce(okResponse(buildAuthResponse()));
    const store = useAuthStore();
    await store.login('a@b.com', 'p');
    expect(store.isAuthenticated).toBe(true);

    // Logout
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
    await store.logout();
    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(store.user).toBeNull();
  });
});
