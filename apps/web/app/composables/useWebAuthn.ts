import { computed } from 'vue';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';
import type { AuthTokens } from '@adyton/shared';
import { useAuthStore } from '~/stores/auth';

// Summary returned by the registration verify endpoint.
export interface PasskeySummary {
  id: string;
  friendlyName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// The native WebAuthn ceremony (navigator.credentials.create/get) throws DOMExceptions
// whose `name` carries the real cause. Map only those to friendly Errors — server-side
// errors (from apiFetch) propagate untouched so callers can act on their messages
// (e.g. login's expired/too-many-attempts reset logic).
function mapCeremonyError(err: unknown, context: 'register' | 'authenticate'): Error {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') {
    return new Error('Passkey prompt was dismissed or timed out. Please try again.');
  }
  if (name === 'InvalidStateError' && context === 'register') {
    return new Error('This passkey is already registered to your account.');
  }
  if (name === 'AbortError') {
    return new Error('Passkey prompt was cancelled.');
  }
  if (name === 'SecurityError' || name === 'NotSupportedError') {
    return new Error('Passkeys are not available in this browser or context.');
  }
  // Unknown ceremony failure — keep any existing message but stay generic.
  return new Error(
    (err as { message?: string })?.message ?? 'Passkey operation failed. Please try again.',
  );
}

export function useWebAuthn() {
  const auth = useAuthStore();

  const supported = computed(() => browserSupportsWebAuthn());

  // Register a new passkey for the signed-in account: fetch creation options, run the
  // create ceremony, then verify. Requires TOTP enabled server-side (400 otherwise).
  async function registerPasskey(friendlyName: string): Promise<PasskeySummary> {
    const optionsJSON = await auth.apiFetch<PublicKeyCredentialCreationOptionsJSON>(
      '/auth/webauthn/register/options',
      { method: 'POST' },
    );

    let attestation: RegistrationResponseJSON;
    try {
      attestation = await startRegistration({ optionsJSON });
    } catch (err) {
      throw mapCeremonyError(err, 'register');
    }

    return auth.apiFetch<PasskeySummary>('/auth/webauthn/register/verify', {
      method: 'POST',
      body: { response: attestation, friendlyName },
    });
  }

  // Complete the login passkey path: fetch request options keyed by the single-use
  // mfaToken, run the get ceremony, then verify through the store action that stores
  // the resulting tokens. Options/verify are public (no Bearer required); apiFetch only
  // attaches Authorization when an access token is present, so it works unauthenticated.
  async function authenticateWithPasskey(mfaToken: string): Promise<AuthTokens> {
    const optionsJSON = await auth.apiFetch<PublicKeyCredentialRequestOptionsJSON>(
      '/auth/webauthn/authenticate/options',
      { method: 'POST', body: { mfaToken } },
    );

    let assertion: AuthenticationResponseJSON;
    try {
      assertion = await startAuthentication({ optionsJSON });
    } catch (err) {
      throw mapCeremonyError(err, 'authenticate');
    }

    return auth.authenticateWebAuthnVerify({ mfaToken, response: assertion });
  }

  return { supported, registerPasskey, authenticateWithPasskey };
}
