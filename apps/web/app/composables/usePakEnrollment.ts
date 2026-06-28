import { ref, readonly } from 'vue';
import {
  generateEphemeralKeypair,
  exportPublicKeySpki,
  importPublicKeySpki,
  deriveQrSessionKey,
  encryptForTransport,
  hexToBytes,
  PAK_PROTOCOL,
  wrapVaultKeyForRecovery,
  type RecoveryKitServerPayload,
} from '@adyton/shared';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { deriveRawKey } from '~/composables/useArgon2Worker';
import { useBiometricUnlock } from '~/composables/useBiometricUnlock';

export type EnrollPhase =
  | 'idle'
  | 'starting'
  | 'qr-shown'
  | 'phone-connected'
  | 'confirming'
  | 'sending'
  | 'recovery-kit-pending'
  | 'finalizing'
  | 'enrolled'
  | 'error';

export function usePakEnrollment() {
  const phase = ref<EnrollPhase>('idle');
  const qrUrl = ref<string | null>(null);
  const error = ref<string | null>(null);
  const connectedDeviceId = ref<string | null>(null);
  const pendingMnemonic = ref<string[] | null>(null);

  // Non-reactive key material — do NOT wrap in ref (ZK: no deep proxy on key material)
  let ephemeralPrivate: CryptoKey | null = null;
  let sessionId: string | null = null;
  let challengeHex: string | null = null;
  let phoneEphemeralPub: string | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  // Pending enrollment payloads — held until user confirms the recovery kit
  let pendingPhone: { ciphertext: string; iv: string } | null = null;
  let pendingKit: RecoveryKitServerPayload | null = null;

  function clearPollTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function cleanup() {
    clearPollTimer();
    ephemeralPrivate = null;
    sessionId = null;
    challengeHex = null;
    phoneEphemeralPub = null;
    pendingPhone = null;
    pendingKit = null;
    pendingMnemonic.value = null;
    qrUrl.value = null;
    connectedDeviceId.value = null;
  }

  function schedulePoll() {
    clearPollTimer();
    pollTimer = setTimeout(() => void pollEnrollStatus(), 2000);
  }

  async function pollEnrollStatus() {
    if (!sessionId) return;
    const authStore = useAuthStore();
    try {
      const result = await authStore.apiFetch<{
        status: 'waiting' | 'phone_ready';
        phoneEphemeralPub?: string;
        deviceId?: string;
      }>(`/auth/enroll-status/${sessionId}`);

      if (result.status === 'phone_ready') {
        clearPollTimer();
        phoneEphemeralPub = result.phoneEphemeralPub!;
        connectedDeviceId.value = result.deviceId ?? null;
        phase.value = 'phone-connected';
      } else {
        schedulePoll();
      }
    } catch {
      // Transient network error — keep polling
      schedulePoll();
    }
  }

  async function start(): Promise<void> {
    if (phase.value !== 'idle') return;
    phase.value = 'starting';
    error.value = null;
    try {
      const kp = await generateEphemeralKeypair();
      ephemeralPrivate = kp.privateKey;
      const desktopPublicKeySpki = await exportPublicKeySpki(kp.publicKey);

      const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
      challengeHex = Array.from(challengeBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const authStore = useAuthStore();
      const result = await authStore.apiFetch<{ sessionId: string; ttlSeconds: number }>(
        '/auth/enroll-session',
        { method: 'POST', body: { desktopPublicKeySpki, challengeHex } },
      );

      sessionId = result.sessionId;
      const payload = JSON.stringify({ s: sessionId, p: desktopPublicKeySpki, c: challengeHex, m: 'enroll' });
      qrUrl.value = 'adyton://pak?d=' + btoa(payload);
      phase.value = 'qr-shown';
      schedulePoll();
    } catch (err: unknown) {
      cleanup();
      phase.value = 'error';
      error.value = err instanceof Error ? err.message : 'Failed to start enrollment session.';
    }
  }

  async function confirmAndSend(masterPassword: string): Promise<void> {
    if (phase.value !== 'phone-connected') return;
    phase.value = 'confirming';
    error.value = null;

    const authStore = useAuthStore();
    const kdfSalt = authStore.user?.kdfSalt;
    if (!kdfSalt) {
      phase.value = 'error';
      error.value = 'User session missing. Please log in again.';
      return;
    }

    let raw: ArrayBuffer | null = null;
    try {
      raw = await deriveRawKey(masterPassword, kdfSalt);

      const cryptoStore = useCryptoStore();
      const currentKey = cryptoStore.cryptoKey;
      if (!currentKey) {
        new Uint8Array(raw).fill(0);
        phase.value = 'error';
        error.value = 'Vault is locked. Unlock it first.';
        return;
      }

      const { verifyRawKeyMatches } = useBiometricUnlock();
      const ok = await verifyRawKeyMatches(raw, currentKey);
      if (!ok) {
        new Uint8Array(raw).fill(0);
        phase.value = 'error';
        error.value = 'Wrong master password.';
        return;
      }

      phase.value = 'sending';

      const phoneKey = await importPublicKeySpki(phoneEphemeralPub!);
      const challengeBytes = hexToBytes(challengeHex!) as Uint8Array<ArrayBuffer>;
      const sessionKey = await deriveQrSessionKey(ephemeralPrivate!, phoneKey, challengeBytes);

      const rawBytes = new Uint8Array(raw) as Uint8Array<ArrayBuffer>;
      const { ciphertext, iv } = await encryptForTransport(sessionKey, rawBytes, PAK_PROTOCOL.enrollmentAad);

      // Recovery kit — must be wrapped BEFORE zeroizing raw bytes and BEFORE any server POST
      const kit = await wrapVaultKeyForRecovery(rawBytes);
      pendingKit = { recoverySalt: kit.recoverySalt, recoveryWrappedVaultKey: kit.recoveryWrappedVaultKey, wrapIv: kit.wrapIv };
      pendingPhone = { ciphertext, iv };
      pendingMnemonic.value = kit.mnemonic.split(' ');

      // Zeroize immediately — raw key bytes must not outlive this scope
      new Uint8Array(raw).fill(0);
      raw = null;

      // Do NOT post to the server yet — user must confirm the recovery kit first
      phase.value = 'recovery-kit-pending';
      ephemeralPrivate = null;
      phoneEphemeralPub = null;
      challengeHex = null;
    } catch (err: unknown) {
      if (raw !== null) new Uint8Array(raw).fill(0);
      pendingPhone = null;
      pendingKit = null;
      pendingMnemonic.value = null;
      phase.value = 'error';
      error.value = err instanceof Error ? err.message : 'Enrollment failed.';
    }
  }

  async function finalizeEnrollment(): Promise<void> {
    if (!pendingKit || !pendingPhone || !sessionId) return;
    phase.value = 'finalizing';
    const authStore = useAuthStore();
    try {
      // Recovery kit POST must happen before phone enrollment POST (security invariant)
      await authStore.apiFetch('/auth/recovery/setup', { method: 'POST', body: pendingKit });
      await authStore.apiFetch(`/auth/enroll-vault/${sessionId}`, { method: 'POST', body: pendingPhone });
      localStorage.setItem('adyton_pak_device_' + authStore.user!.id, connectedDeviceId.value!);
      pendingKit = null;
      pendingPhone = null;
      pendingMnemonic.value = null;
      phase.value = 'enrolled';
    } catch (err: unknown) {
      pendingKit = null;
      pendingPhone = null;
      pendingMnemonic.value = null;
      phase.value = 'error';
      error.value = err instanceof Error ? err.message : 'Enrollment failed.';
    }
  }

  async function cancel(): Promise<void> {
    clearPollTimer();
    if (sessionId) {
      const sid = sessionId;
      const authStore = useAuthStore();
      try {
        await authStore.apiFetch(`/auth/enroll-session/${sid}`, { method: 'DELETE' });
      } catch {
        // Best-effort — ignore errors
      }
    }
    cleanup();
    phase.value = 'idle';
  }

  function reset(): void {
    cleanup();
    phase.value = 'idle';
    error.value = null;
  }

  return {
    phase: readonly(phase),
    qrUrl: readonly(qrUrl),
    error: readonly(error),
    connectedDeviceId: readonly(connectedDeviceId),
    pendingMnemonic: readonly(pendingMnemonic),
    start,
    confirmAndSend,
    finalizeEnrollment,
    cancel,
    reset,
  };
}
