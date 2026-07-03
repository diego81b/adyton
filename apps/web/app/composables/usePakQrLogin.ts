import { ref, readonly } from 'vue';
import { useRouter } from 'vue-router';
import {
  generateEphemeralKeypair,
  exportPublicKeySpki,
  importPublicKeySpki,
  deriveQrSessionKey,
  decryptFromTransport,
} from '@adyton/shared';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { useVaultStore } from '~/stores/vault';

export type QrPhase = 'idle' | 'starting' | 'pending' | 'approved' | 'denied' | 'expired' | 'error';

// Local helper — NOT exported
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function usePakQrLogin(opts: { navigateOnUnlock?: boolean } = {}) {
  const { navigateOnUnlock = true } = opts;
  const phase = ref<QrPhase>('idle');
  const qrUrl = ref<string | null>(null);
  const error = ref<string | null>(null);

  // Non-reactive plain variables — do NOT wrap in ref (ZK: no deep proxy on key material)
  let ephemeralPrivate: CryptoKey | null = null;
  let sessionIdValue: string | null = null;
  let challengeHexValue: string | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPollTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function cleanup() {
    clearPollTimer();
    ephemeralPrivate = null;
    sessionIdValue = null;
    challengeHexValue = null;
    qrUrl.value = null;
  }

  function schedulePoll() {
    clearPollTimer();
    pollTimer = setTimeout(() => void poll(), 2000);
  }

  async function handleApproved(
    phoneEphemeralPub: string,
    ciphertext: string,
    iv: string,
    sid: string,
  ) {
    try {
      const phonePublicKey = await importPublicKeySpki(phoneEphemeralPub);
      const challengeBytes = hexToBytes(challengeHexValue!);
      const sessionKey = await deriveQrSessionKey(ephemeralPrivate!, phonePublicKey, challengeBytes);
      const rawKeyBytes = await decryptFromTransport(sessionKey, ciphertext, iv, sid);

      const cryptoStore = useCryptoStore();
      const vaultStore = useVaultStore();

      await cryptoStore.unlockWithRawKey(rawKeyBytes.buffer as ArrayBuffer);
      phase.value = 'approved';
      await vaultStore.fetchAll();
      // /unlock is a route page — leaving it requires an explicit push. The lock
      // overlay unlocks in place (same pattern as its password/biometric paths) and
      // closes itself once cryptoStore.isUnlocked flips, so it opts out here.
      if (navigateOnUnlock) {
        const router = useRouter();
        await router.push('/vault');
      }
    } catch (err: unknown) {
      const cryptoStore = useCryptoStore();
      const vaultStore = useVaultStore();
      cryptoStore.lock();
      vaultStore.clear();
      phase.value = 'error';
      error.value = err instanceof Error ? err.message : 'Failed to decrypt vault key.';
    }
  }

  async function poll() {
    if (!sessionIdValue) return;
    const authStore = useAuthStore();
    try {
      const result = await authStore.apiFetch<{
        status: 'pending' | 'approved' | 'denied' | 'expired';
        phoneEphemeralPub?: string;
        ciphertext?: string;
        iv?: string;
        deviceId?: string;
        signature?: string;
      }>(`/auth/qr-poll/${sessionIdValue}`);

      if (result.status === 'pending') {
        schedulePoll();
      } else if (result.status === 'approved') {
        clearPollTimer();
        await handleApproved(
          result.phoneEphemeralPub!,
          result.ciphertext!,
          result.iv!,
          sessionIdValue,
        );
      } else {
        // 'denied' | 'expired'
        clearPollTimer();
        phase.value = result.status;
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
      challengeHexValue = Array.from(challengeBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const authStore = useAuthStore();
      const result = await authStore.apiFetch<{ sessionId: string; challengeHex: string; ttlSeconds: number }>(
        '/auth/qr',
        { method: 'POST', body: { desktopPublicKeySpki, challengeHex: challengeHexValue } },
      );

      sessionIdValue = result.sessionId;
      const payload = JSON.stringify({ s: result.sessionId, p: desktopPublicKeySpki, c: challengeHexValue });
      qrUrl.value = 'adyton://pak?d=' + btoa(payload);
      phase.value = 'pending';
      schedulePoll();
    } catch (err: unknown) {
      cleanup();
      phase.value = 'error';
      error.value = err instanceof Error ? err.message : 'Failed to start QR session.';
    }
  }

  async function cancel(): Promise<void> {
    clearPollTimer();
    if (sessionIdValue) {
      const sid = sessionIdValue;
      const authStore = useAuthStore();
      // Best-effort — ignore errors
      try {
        await authStore.apiFetch(`/auth/qr-relay/${sid}`, { method: 'DELETE' });
      } catch {
        // Ignore
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
    start,
    cancel,
    reset,
  };
}
