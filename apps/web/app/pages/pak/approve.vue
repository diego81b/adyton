<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useNativeRuntime } from '~/composables/useNativeRuntime';
import { AdytonKeystore } from '@adyton/capacitor-keystore';

definePageMeta({ ssr: false, layout: false });

// DeviceResponseDto as returned by GET /devices
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

// QR payload decoded from the ?d= param
interface QrPayload {
  s: string; // sessionId
  p: string; // desktopPublicKeySpki
  c: string; // challengeHex
}

type ApprovePhase = 'loading' | 'ready' | 'approving' | 'success' | 'error' | 'not-enrolled';

const PAK_DEVICE_KEY_PREFIX = 'adyton_pak_device_';

const authStore = useAuthStore();
const { isNative } = useNativeRuntime();
const router = useRouter();
const route = useRoute();

const approvePhase = ref<ApprovePhase>('loading');
const approveError = ref<string | null>(null);

/* global localStorage */
// Parsed data — populated once decoding succeeds
let qrData: QrPayload | null = null;
let enrolledDevice: DeviceResponseDto | null = null;

onMounted(async () => {
  // This page is phone-only — redirect desktop users
  if (!isNative) {
    await router.push('/vault');
    return;
  }

  // Ensure we have an authenticated session before hitting /devices
  if (!authStore.user) {
    const ok = await authStore.initialize();
    if (!ok) {
      await router.push('/login');
      return;
    }
  }

  // Decode the QR payload from the ?d param
  const raw = route.query['d'];
  if (typeof raw !== 'string') {
    approvePhase.value = 'error';
    approveError.value = 'Missing QR data. Please scan the QR code again.';
    return;
  }

  try {
    qrData = JSON.parse(atob(raw)) as QrPayload;
  } catch {
    approvePhase.value = 'error';
    approveError.value = 'Invalid QR data. Please scan the QR code again.';
    return;
  }

  if (!qrData.s || !qrData.p || !qrData.c) {
    approvePhase.value = 'error';
    approveError.value = 'Incomplete QR data. Please scan the QR code again.';
    return;
  }

  // Look up the active Android device enrolled for PAK
  try {
    const devices = await authStore.apiFetch<DeviceResponseDto[]>('/devices');
    enrolledDevice = devices.find((d) => d.platform === 'android' && d.revokedAt === null) ?? null;
  } catch {
    approvePhase.value = 'error';
    approveError.value = 'Failed to load device info. Check your connection and try again.';
    return;
  }

  if (!enrolledDevice) {
    approvePhase.value = 'not-enrolled';
    return;
  }

  approvePhase.value = 'ready';
});

async function approve() {
  if (!qrData || !enrolledDevice) return;
  const localDeviceId = localStorage.getItem(PAK_DEVICE_KEY_PREFIX + authStore.user!.id);
  if (!localDeviceId) {
    approvePhase.value = 'not-enrolled';
    return;
  }
  approvePhase.value = 'approving';
  approveError.value = null;

  try {
    // Verify keys are still present in Keystore before attempting biometric prompt
    const { exists } = await AdytonKeystore.hasKeys({ deviceId: localDeviceId });
    if (!exists) {
      approvePhase.value = 'not-enrolled';
      return;
    }

    // Sign the sessionId to prove possession of the Keystore SIGN key
    const signResult = await AdytonKeystore.sign({
      deviceId: localDeviceId,
      dataBase64: btoa(qrData.s),
    });

    // ECDH with the desktop's ephemeral key, AES-GCM encrypt the vault key
    const relayResult = await AdytonKeystore.encryptForRelay({
      deviceId: localDeviceId,
      remotePublicKeySpki: qrData.p,
      challengeHex: qrData.c,
      sessionId: qrData.s,
    });

    // Submit the encrypted payload to the relay endpoint
    await authStore.apiFetch(`/auth/qr-relay/${qrData.s}`, {
      method: 'POST',
      body: {
        phoneEphemeralPub: relayResult.phoneEphemeralPub,
        ciphertext: relayResult.ciphertext,
        iv: relayResult.iv,
        deviceId: enrolledDevice.publicKeyFingerprint,
        signature: signResult.signatureBase64,
      },
    });

    approvePhase.value = 'success';
    await router.push('/vault');
  } catch (err: unknown) {
    approvePhase.value = 'error';
    approveError.value =
      err !== null && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Approval failed. Please try again.';
  }
}

async function decline() {
  if (qrData?.s) {
    // Best-effort — don't block navigation on failure
    authStore.apiFetch(`/auth/qr-relay/${qrData.s}`, { method: 'DELETE' }).catch(() => {});
  }
  await router.push('/vault');
}
</script>

<template>
  <div class="flex min-h-screen items-start justify-center bg-default p-4 pt-16">
    <div class="w-full max-w-sm space-y-4">
      <!-- Header -->
      <div class="text-center">
        <div
          class="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-elevated"
        >
          <UIcon name="i-lucide-key-round" class="size-6 text-primary" aria-hidden="true" />
        </div>
        <h1 class="text-lg font-semibold">Vault Unlock Request</h1>
        <p class="mt-1 text-sm text-muted">A device is requesting access to your vault.</p>
      </div>

      <!-- Loading -->
      <div v-if="approvePhase === 'loading'" class="flex justify-center py-8">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" aria-hidden="true" />
      </div>

      <!-- Not enrolled -->
      <div v-else-if="approvePhase === 'not-enrolled'" class="space-y-4">
        <UAlert
          color="warning"
          variant="soft"
          title="Device not enrolled"
          description="This device has not been enrolled as a PAK key. Enroll it in Settings before using phone-based unlock."
        />
        <UButton block size="lg" variant="ghost" @click="router.push('/settings')">
          Go to Settings
        </UButton>
      </div>

      <!-- Ready to approve -->
      <template v-else-if="approvePhase === 'ready' || approvePhase === 'approving'">
        <!-- Session details -->
        <div class="rounded-lg border border-default bg-elevated divide-y divide-default">
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-xs font-medium uppercase tracking-wider text-muted">Session</span>
            <span class="font-mono text-sm tabular-nums text-default">
              {{ qrData?.s.slice(0, 8) }}…
            </span>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-xs font-medium uppercase tracking-wider text-muted">Challenge</span>
            <span class="font-mono text-sm tabular-nums text-default">
              {{ qrData?.c.slice(0, 8) }}…
            </span>
          </div>
        </div>

        <!-- Security warning -->
        <UAlert
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="Verify before approving"
          description="Only approve if YOU initiated this unlock on another device. Do not approve requests you did not make."
        />

        <!-- Action buttons -->
        <div class="space-y-2">
          <UButton
            block
            size="lg"
            color="primary"
            :loading="approvePhase === 'approving'"
            :disabled="approvePhase === 'approving'"
            @click="approve"
          >
            {{ approvePhase === 'approving' ? 'Approving…' : 'Approve' }}
          </UButton>
          <UButton
            block
            size="lg"
            color="error"
            variant="ghost"
            :disabled="approvePhase === 'approving'"
            @click="decline"
          >
            Decline
          </UButton>
        </div>
      </template>

      <!-- Error -->
      <div v-else-if="approvePhase === 'error'" class="space-y-4">
        <UAlert
          color="error"
          variant="soft"
          title="Something went wrong"
          :description="approveError ?? 'An unexpected error occurred.'"
        />
        <UButton block size="lg" variant="ghost" @click="router.push('/vault')">
          Back to Vault
        </UButton>
      </div>
    </div>
  </div>
</template>
