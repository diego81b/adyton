import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { AuthTokens } from '@adyton/shared';

interface AuthUser {
  id: string;
  email: string;
  kdfSalt: string;
  totpEnabled: boolean;
}

// Base URL resolved lazily so it works in tests (where useRuntimeConfig may be mocked)
// and in Nuxt runtime. Falls back to '/api' if not configured.
function getBaseUrl(): string {
  if (typeof useRuntimeConfig === 'function') {
    try {
      const config = useRuntimeConfig();
      return (config.public.apiBaseUrl as string) || '/api';
    } catch {
      // Outside Nuxt context (e.g. unit tests) — fall back to env or default
    }
  }
  return (globalThis as Record<string, unknown>).__TEST_API_BASE__ as string ?? '/api';
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<AuthUser | null>(null);

  const isAuthenticated = computed(() => accessToken.value !== null);

  function setAuthResult(data: AuthTokens) {
    accessToken.value = data.accessToken;
    user.value = data.user;
  }

  function clear() {
    accessToken.value = null;
    user.value = null;
  }

  async function apiFetch<T>(path: string, options?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T> {
    const baseUrl = getBaseUrl();
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {}),
        ...(options?.headers as Record<string, string> ?? {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string };
      throw Object.assign(new Error(data.message ?? res.statusText), { status: res.status, data });
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async function login(email: string, password: string) {
    const data = await apiFetch<AuthTokens>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAuthResult(data);
    return data;
  }

  async function register(email: string, password: string) {
    const data = await apiFetch<AuthTokens>('/auth/register', {
      method: 'POST',
      body: { email, password },
    });
    setAuthResult(data);
    return data;
  }

  async function refresh(): Promise<boolean> {
    try {
      const data = await apiFetch<AuthTokens>('/auth/refresh', { method: 'POST' });
      setAuthResult(data);
      return true;
    } catch {
      clear();
      return false;
    }
  }

  async function logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      clear();
      const { useCryptoStore } = await import('./crypto');
      useCryptoStore().lock();
    }
  }

  // Called from auth middleware on every navigation to protected routes.
  // Performs silent token refresh when no access token is present.
  async function initialize(): Promise<boolean> {
    if (accessToken.value) return true;
    return refresh();
  }

  return { accessToken, user, isAuthenticated, login, register, refresh, logout, initialize };
});
