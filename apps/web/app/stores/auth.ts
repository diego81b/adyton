import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { AuthTokens, LoginResponse } from '@adyton/shared';

interface AuthUser {
  id: string;
  email: string;
  kdfSalt: string;
  totpEnabled: boolean;
}

// Base URL resolved lazily so it works in tests (where useRuntimeConfig may be mocked)
// and in Nuxt runtime. NUXT_PUBLIC_API_BASE_URL is the bare origin (no /api suffix);
// this function appends /api so callers only pass the path (e.g. '/auth/login').
function getBaseUrl(): string {
  if (typeof useRuntimeConfig === 'function') {
    try {
      const config = useRuntimeConfig();
      const base = (config.public.apiBaseUrl as string) || '';
      return `${base}/api`;
    } catch {
      // Outside Nuxt context (e.g. unit tests) — fall back to env or default
    }
  }
  const base = (globalThis as Record<string, unknown>).__TEST_API_BASE__ as string ?? '';
  return `${base}/api`;
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

  async function apiFetch<T>(
    path: string,
    options?: Omit<RequestInit, 'body'> & { body?: unknown },
    retried = false,
  ): Promise<T> {
    const baseUrl = getBaseUrl();
    const hasBody = options?.body !== undefined;
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        // Only declare a JSON content-type when we actually send a body — Fastify
        // rejects an empty body that carries Content-Type: application/json (400),
        // which would break the no-body POSTs (/auth/refresh, /auth/logout).
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {}),
        ...(options?.headers as Record<string, string> ?? {}),
      },
      body: hasBody ? JSON.stringify(options!.body) : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      // Expired access token on a non-auth route: silent-refresh once and retry.
      // Still 401 (or refresh failed) → the session is dead; never leave the user on a
      // half-rendered page — clear client state and send them to /login. Auth routes
      // are excluded: their 401s are real credential errors (and /auth/refresh going
      // through here would recurse).
      if (res.status === 401 && !path.startsWith('/auth/') && !retried) {
        if (await refresh()) return apiFetch<T>(path, options, true);
        await redirectToLogin();
      } else if (res.status === 401 && !path.startsWith('/auth/')) {
        await redirectToLogin();
      }
      const data = await res.json().catch(() => ({})) as { message?: string };
      throw Object.assign(new Error(data.message ?? res.statusText), { status: res.status, data });
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // Session is unrecoverable: wipe all client state and hard-redirect to /login.
  // window.location (not router) on purpose — the reload also clears the in-memory
  // vault key and any per-page state, leaving a clean slate for the next sign-in.
  async function redirectToLogin() {
    clear();
    const { useCryptoStore } = await import('./crypto');
    const { useVaultStore } = await import('./vault');
    const { useSettingsStore } = await import('./settings');
    useVaultStore().clear();
    useSettingsStore().clear();
    useCryptoStore().lock();
    window.location.assign('/login');
  }

  async function login(email: string, password: string): Promise<LoginResponse> {
    const data = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    // A 2FA-enabled account returns no tokens — the caller must complete the second
    // factor via authenticateTwoFactor. Only set auth state on a full token response.
    if (!('requiresMfa' in data)) setAuthResult(data);
    return data;
  }

  // Second login stage for 2FA accounts: exchange the single-use mfaToken plus a TOTP
  // code OR a recovery code for real tokens (and the refresh cookie). Exactly one of
  // code/recoveryCode is provided by the caller.
  async function authenticateTwoFactor(payload: {
    mfaToken: string;
    code?: string;
    recoveryCode?: string;
  }): Promise<AuthTokens> {
    const data = await apiFetch<AuthTokens>('/auth/2fa/authenticate', {
      method: 'POST',
      body: payload,
    });
    setAuthResult(data);
    return data;
  }

  // WebAuthn second login stage: exchange the single-use mfaToken plus a signed
  // assertion (from the navigator.credentials.get ceremony) for real tokens and the
  // refresh cookie. Mirrors authenticateTwoFactor — the verify endpoint is public.
  async function authenticateWebAuthnVerify(payload: {
    mfaToken: string;
    response: unknown;
  }): Promise<AuthTokens> {
    const data = await apiFetch<AuthTokens>('/auth/webauthn/authenticate/verify', {
      method: 'POST',
      body: payload,
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
      const { useVaultStore } = await import('./vault');
      const { useSettingsStore } = await import('./settings');
      useVaultStore().clear();
      useSettingsStore().clear();
      useCryptoStore().lock();
    }
  }

  // Called from auth middleware on every navigation to protected routes.
  // Performs silent token refresh when no access token is present.
  async function initialize(): Promise<boolean> {
    if (accessToken.value) return true;
    return refresh();
  }

  return { accessToken, user, isAuthenticated, apiFetch, login, authenticateTwoFactor, authenticateWebAuthnVerify, register, refresh, logout, initialize };
});
