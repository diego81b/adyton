<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { AdytonKeystore } from '@adyton/capacitor-keystore';
import {
  generateEphemeralKeypair,
  exportPublicKeySpki,
  importPublicKeySpki,
  deriveQrSessionKey,
  decryptFromTransport,
} from '@adyton/shared';
import { useAuthStore } from '~/stores/auth';
import { useNativeRuntime } from '~/composables/useNativeRuntime';

definePageMeta({ ssr: false, layout: false });

// QR payload decoded from the ?d= param
interface EnrollQrPayload {
  s: string;  // sessionId
  p: string;  // desktopPublicKeySpki (base64 SPKI)
  c: string;  // challengeHex (64 chars)
  m: 'enroll';
}

// Backend poll response — mirrors EnrollVaultStatusResponseDto (apps/api/src/pak/dto/pak-response.dto.ts)
interface EnrollVaultPollResponse {
  status: 'waiting' | 'ready';
  ciphertext?: string;
  iv?: string;
}

// Backend device response
interface DeviceResponseDto {
  id: string;
  deviceName: string;
  platform: string;
  enrollmentMethod: string;
  enrolledAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  publicKeyFingerprint: string;
}

type EnrollPhase = 'loading' | 'enrolling' | 'waiting-vault' | 'sealing' | 'success' | 'error' | 'not-supported';

const PAK_DEVICE_KEY_PREFIX = 'adyton_pak_device_';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes

const authStore = useAuthStore();
const { isNative, platform } = useNativeRuntime();
const router = useRouter();
const route = useRoute();

const enrollPhase = ref<EnrollPhase>('loading');
const enrollError = ref<string | null>(null);
const statusText = ref<string>('Initializing…');

/* global CryptoKey, localStorage */
// Non-reactive: key material and mutable session state must NOT be Vue refs.
// Storing these as refs would serialize them to the virtual DOM and potentially
// leak them via Vue DevTools or reactivity logs.
let ephPrivate: CryptoKey | null = null;
let localDeviceId: string | null = null;
let qrData: EnrollQrPayload | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollStartedAt = 0;

// ---------------------------------------------------------------------------
// Helper: hex string → Uint8Array<ArrayBuffer>
// Must cast through as Uint8Array<ArrayBuffer> for noUncheckedIndexedAccess.
// ---------------------------------------------------------------------------
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------
function clearPollTimer() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function setError(msg: string) {
  clearPollTimer();
  enrollPhase.value = 'error';
  enrollError.value = msg;
}

// ---------------------------------------------------------------------------
// Enrollment flow
// ---------------------------------------------------------------------------
async function runEnrollment() {
  // Gate: android only
  if (!isNative || platform !== 'android') {
    enrollPhase.value = 'not-supported';
    return;
  }

  // Ensure authenticated session
  if (!authStore.user) {
    const ok = await authStore.initialize();
    if (!ok) {
      await router.push({ path: '/login', query: { redirect: route.fullPath } });
      return;
    }
  }

  // Decode + validate QR payload
  const raw = route.query['d'];
  if (typeof raw !== 'string') {
    setError('Missing QR data. Please scan the QR code again.');
    return;
  }

  try {
    qrData = JSON.parse(atob(raw)) as EnrollQrPayload;
  } catch {
    setError('Invalid QR data. Please scan the QR code again.');
    return;
  }

  if (!qrData.s || !qrData.p || !qrData.c || qrData.m !== 'enroll') {
    setError('Incomplete QR data. Please scan the QR code again.');
    return;
  }

  enrollPhase.value = 'enrolling';
  statusText.value = 'Generating device keys…';

  try {
    // Step 3: Generate a local device ID for this enrollment
    localDeviceId = crypto.randomUUID();

    // Step 4: Generate SE P-256 ECDH + SIGN keypairs in Android Keystore
    statusText.value = 'Creating Keystore keys…';
    await AdytonKeystore.generateKeys({ deviceId: localDeviceId });

    // Step 5: Get the persistent public keys
    statusText.value = 'Reading public keys…';
    const persistent = await AdytonKeystore.getPublicKeys({ deviceId: localDeviceId });

    // Step 6: Generate software ephemeral P-256 keypair for this session
    // Hold private key in a plain variable (not ref) — never persisted.
    statusText.value = 'Generating session keys…';
    const ephKeypair = await generateEphemeralKeypair();
    ephPrivate = ephKeypair.privateKey;
    const ephPub = await exportPublicKeySpki(ephKeypair.publicKey);

    // Step 7: Sign the sessionId to prove possession of the Keystore SIGN key.
    // Biometric prompt fires here on device.
    statusText.value = 'Authorizing with biometrics…';
    const signResult = await AdytonKeystore.sign({
      deviceId: localDeviceId,
      dataBase64: btoa(qrData.s),
    });

    // Step 8: POST /pak/devices/enroll
    // _device: server-assigned ID unused here; Keystore is keyed to localDeviceId throughout
    statusText.value = 'Registering device…';
    const _device = await authStore.apiFetch<DeviceResponseDto>('/pak/devices/enroll', {
      method: 'POST',
      body: {
        devicePublicKeySpki: persistent.ecdhPublicKey,
        deviceName: 'My Phone',
        platform: 'android',
        enrollmentMethod: 'master_password',
        enrollmentEphemeralPub: ephPub,
        enrollmentSessionId: qrData.s,
        signature: signResult.signatureBase64,
      },
    });

    // Step 10: Start polling for the encrypted vault key
    enrollPhase.value = 'waiting-vault';
    statusText.value = 'Waiting for desktop to send vault key…';
    pollStartedAt = Date.now();
    schedulePoll();
  } catch (err: unknown) {
    const msg = err !== null && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'Enrollment failed. Please try again.';
    setError(msg);
  }
}

// ---------------------------------------------------------------------------
// Poll until the desktop pushes the encrypted vault key
// ---------------------------------------------------------------------------
function schedulePoll() {
  pollTimer = setTimeout(() => void pollEnrollVault(), POLL_INTERVAL_MS);
}

async function pollEnrollVault() {
  if (!qrData || !localDeviceId) return;

  // Timeout guard — if desktop never sends, give up
  if (Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
    setError('Timed out waiting for vault key. Please try again.');
    return;
  }

  try {
    const response = await authStore.apiFetch<EnrollVaultPollResponse>(
      `/auth/enroll-vault/${qrData.s}`,
    );

    if (response.status === 'waiting') {
      schedulePoll();
      return;
    }

    // status === 'ready'
    if (!response.ciphertext || !response.iv) {
      setError('Received incomplete vault key payload. Please try again.');
      return;
    }

    await sealVaultKey(response.ciphertext, response.iv);
  } catch (err: unknown) {
    const msg = err !== null && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'Failed to poll for vault key. Please try again.';
    setError(msg);
  }
}

// ---------------------------------------------------------------------------
// Seal the vault key received from the desktop
// ---------------------------------------------------------------------------
async function sealVaultKey(ciphertext: string, iv: string) {
  if (!qrData || !ephPrivate || !localDeviceId) {
    setError('Internal error: missing session state.');
    return;
  }

  enrollPhase.value = 'sealing';
  statusText.value = 'Sealing vault key…';

  try {
    // Step 11a: Import the desktop's ephemeral public key
    const desktopEphPub = await importPublicKeySpki(qrData.p);

    // Step 11b: Decode challenge bytes from hex
    const challengeBytes = hexToBytes(qrData.c);

    // Step 11c: Derive the QR session key (ECDH + HKDF)
    const sessionKey = await deriveQrSessionKey(ephPrivate, desktopEphPub, challengeBytes);

    // Step 11d: Decrypt the vault key; AAD must be 'enrollment' (PAK_PROTOCOL.enrollmentAad)
    const rawKeyBytes = await decryptFromTransport(sessionKey, ciphertext, iv, 'enrollment');

    // Step 11e: Seal the raw key bytes in Android Keystore (biometric-protected).
    // vaultKeyRaw is base64-encoded 32 bytes — matches plugin API parameter name.
    const vaultKeyRaw = btoa(String.fromCharCode(...new Uint8Array(rawKeyBytes)));
    await AdytonKeystore.sealVaultKey({ deviceId: localDeviceId, vaultKeyRaw });

    // Zero out the decrypted bytes — they are now sealed in SE
    new Uint8Array(rawKeyBytes).fill(0);

    // Step 11f: Persist the device ID mapping so useBiometricUnlock can find it
    const userId = authStore.user!.id;
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + userId, localDeviceId);

    // Step 11g/h: Success — redirect to vault
    enrollPhase.value = 'success';
    await router.push('/vault');
  } catch (err: unknown) {
    const msg = err !== null && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'Failed to seal vault key. Please try again.';
    setError(msg);
  }
}

onMounted(() => {
  // This page is phone-only — redirect desktop users
  if (!isNative) {
    router.push('/vault');
    return;
  }
  void runEnrollment();
});

onUnmounted(() => {
  clearPollTimer();
  // Best-effort: zeroize ephPrivate reference — the GC will collect it, but
  // clearing the reference makes the intent explicit and prevents accidental reuse.
  ephPrivate = null;
});
</script>

<template>
  <div class="flex min-h-screen items-start justify-center bg-default p-4 pt-16">
    <div class="w-full max-w-sm space-y-4">
      <!-- Header -->
      <div class="text-center">
        <div
          class="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-elevated"
        >
          <UIcon name="i-lucide-smartphone" class="size-6 text-primary" aria-hidden="true" />
        </div>
        <h1 class="text-lg font-semibold">Enroll This Device</h1>
        <p class="mt-1 text-sm text-muted">
          Setting up this phone as a vault key.
        </p>
      </div>

      <!-- Loading / enrolling / waiting-vault / sealing — spinner states -->
      <div
        v-if="enrollPhase === 'loading' || enrollPhase === 'enrolling' || enrollPhase === 'waiting-vault' || enrollPhase === 'sealing'"
        class="space-y-4"
      >
        <div class="flex flex-col items-center gap-3 py-8">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" aria-hidden="true" />
          <p class="text-sm text-muted">{{ statusText }}</p>
        </div>

        <div v-if="enrollPhase === 'waiting-vault'" class="rounded-lg border border-default bg-elevated px-4 py-3">
          <p class="text-xs text-muted">
            On your desktop, open the Adyton desktop panel and confirm the enrollment.
          </p>
        </div>
      </div>

      <!-- Success -->
      <div v-else-if="enrollPhase === 'success'" class="space-y-4">
        <UAlert
          color="success"
          variant="soft"
          icon="i-lucide-circle-check"
          title="Device enrolled"
          description="This phone is now registered as a vault key. Redirecting to vault…"
        />
      </div>

      <!-- Not supported -->
      <div v-else-if="enrollPhase === 'not-supported'" class="space-y-4">
        <UAlert
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="Not supported"
          description="PAK enrollment requires an Android device with biometric hardware."
        />
        <UButton block size="lg" variant="ghost" @click="router.push('/vault')">
          Back to Vault
        </UButton>
      </div>

      <!-- Error -->
      <div v-else-if="enrollPhase === 'error'" class="space-y-4">
        <UAlert
          color="error"
          variant="soft"
          icon="i-lucide-circle-x"
          title="Enrollment failed"
          :description="enrollError ?? 'An unexpected error occurred.'"
        />
        <UButton block size="lg" variant="ghost" @click="router.push('/vault')">
          Back to Vault
        </UButton>
      </div>
    </div>
  </div>
</template>
