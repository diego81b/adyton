import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock @simplewebauthn/browser ---------------------------------------------
const startRegistration = vi.fn();
const startAuthentication = vi.fn();
const browserSupportsWebAuthn = vi.fn(() => true);
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...args: unknown[]) => startRegistration(...args),
  startAuthentication: (...args: unknown[]) => startAuthentication(...args),
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
}));

// --- Mock the auth store ------------------------------------------------------
const apiFetch = vi.fn();
const authenticateWebAuthnVerify = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch, authenticateWebAuthnVerify }),
}));

import { useWebAuthn } from '../../app/composables/useWebAuthn';

beforeEach(() => {
  apiFetch.mockReset();
  authenticateWebAuthnVerify.mockReset();
  startRegistration.mockReset();
  startAuthentication.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
});

describe('useWebAuthn.supported', () => {
  it('reflects browserSupportsWebAuthn', () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    const { supported } = useWebAuthn();
    expect(supported.value).toBe(false);
  });
});

describe('useWebAuthn.registerPasskey', () => {
  it('posts options, runs the ceremony, then posts verify with the attestation + name', async () => {
    const options = { challenge: 'abc' };
    const attestation = { id: 'cred-1', response: {} };
    const summary = { id: 'pk-1', friendlyName: 'YubiKey', createdAt: 'now', lastUsedAt: null };
    apiFetch.mockResolvedValueOnce(options); // register/options
    startRegistration.mockResolvedValueOnce(attestation);
    apiFetch.mockResolvedValueOnce(summary); // register/verify

    const { registerPasskey } = useWebAuthn();
    const result = await registerPasskey('YubiKey');

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/auth/webauthn/register/options', {
      method: 'POST',
    });
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/auth/webauthn/register/verify', {
      method: 'POST',
      body: { response: attestation, friendlyName: 'YubiKey' },
    });
    expect(result).toEqual(summary);
  });

  it('maps a cancelled ceremony (NotAllowedError) to a friendly error and skips verify', async () => {
    apiFetch.mockResolvedValueOnce({ challenge: 'abc' });
    startRegistration.mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'NotAllowedError' }),
    );

    const { registerPasskey } = useWebAuthn();
    await expect(registerPasskey('Key')).rejects.toThrow(/dismissed or timed out/i);
    expect(apiFetch).toHaveBeenCalledTimes(1); // verify never reached
  });

  it('maps InvalidStateError to an already-registered error', async () => {
    apiFetch.mockResolvedValueOnce({ challenge: 'abc' });
    startRegistration.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { name: 'InvalidStateError' }),
    );

    const { registerPasskey } = useWebAuthn();
    await expect(registerPasskey('Key')).rejects.toThrow(/already registered/i);
  });

  it('lets a server error from options propagate untouched', async () => {
    apiFetch.mockRejectedValueOnce(new Error('Enable two-factor authentication before adding passkeys'));
    const { registerPasskey } = useWebAuthn();
    await expect(registerPasskey('Key')).rejects.toThrow(/Enable two-factor authentication/);
    expect(startRegistration).not.toHaveBeenCalled();
  });
});

describe('useWebAuthn.authenticateWithPasskey', () => {
  it('posts options with the mfaToken, runs the ceremony, then calls the store verify action', async () => {
    const options = { challenge: 'xyz' };
    const assertion = { id: 'cred-1', response: {} };
    const tokens = { accessToken: 'tok', user: {} };
    apiFetch.mockResolvedValueOnce(options); // authenticate/options
    startAuthentication.mockResolvedValueOnce(assertion);
    authenticateWebAuthnVerify.mockResolvedValueOnce(tokens);

    const { authenticateWithPasskey } = useWebAuthn();
    const result = await authenticateWithPasskey('mfa-123');

    expect(apiFetch).toHaveBeenCalledWith('/auth/webauthn/authenticate/options', {
      method: 'POST',
      body: { mfaToken: 'mfa-123' },
    });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    expect(authenticateWebAuthnVerify).toHaveBeenCalledWith({
      mfaToken: 'mfa-123',
      response: assertion,
    });
    expect(result).toBe(tokens);
  });

  it('maps a cancelled ceremony to a friendly error and never verifies', async () => {
    apiFetch.mockResolvedValueOnce({ challenge: 'xyz' });
    startAuthentication.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    );

    const { authenticateWithPasskey } = useWebAuthn();
    await expect(authenticateWithPasskey('mfa-123')).rejects.toThrow(/dismissed or timed out/i);
    expect(authenticateWithPasskey).toBeDefined();
    expect(authenticateWebAuthnVerify).not.toHaveBeenCalled();
  });
});
