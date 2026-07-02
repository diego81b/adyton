<script setup lang="ts">
import { ref, watch, watchEffect } from 'vue';
import QRCode from 'qrcode';
import { usePakEnrollment } from '~/composables/usePakEnrollment';
import { useNativeRuntime } from '~/composables/useNativeRuntime';
import SettingRow from './SettingRow.vue';

const emit = defineEmits<{ enrolled: [] }>();

const { isNative } = useNativeRuntime();
const { phase, qrUrl, error, pendingMnemonic, start, confirmAndSend, finalizeEnrollment, cancel, reset } = usePakEnrollment();
const masterPassword = ref('');
const canvasEl = ref<HTMLCanvasElement | null>(null);

watch(phase, (next) => {
  if (next === 'enrolled') emit('enrolled');
});

watchEffect(() => {
  if (!canvasEl.value || !qrUrl.value) return;
  QRCode.toCanvas(canvasEl.value, qrUrl.value, {
    width: 220,
    margin: 2,
    color: { dark: '#011a1f', light: '#f8fafb' },
  }).catch(() => {
    // QR render error — canvas stays blank
  });
});

async function handleConfirm() {
  await confirmAndSend(masterPassword.value);
  masterPassword.value = '';
}
</script>

<template>
  <!-- Desktop-only: on native the user goes through the phone's /pak/enroll flow -->
  <template v-if="!isNative">
    <!-- idle: entry point -->
    <SettingRow
      v-if="phase === 'idle'"
      label="Phone as Key"
      helper="Enroll your phone to unlock the vault via QR scan — no master password required on return visits"
    >
      <template #action>
        <UButton
          color="primary"
          variant="subtle"
          size="md"
          icon="i-lucide-smartphone"
          aria-label="Start phone enrollment"
          class="flex-1 justify-center sm:flex-none"
          @click="start"
        >
          Enroll phone
        </UButton>
      </template>
    </SettingRow>

    <!-- starting: generating keypair + contacting server -->
    <SettingRow
      v-else-if="phase === 'starting'"
      label="Phone as Key"
      helper="Generating session…"
    >
      <template #action>
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" aria-label="Loading" />
      </template>
    </SettingRow>

    <!-- qr-shown: waiting for phone to scan -->
    <template v-else-if="phase === 'qr-shown'">
      <SettingRow
        label="Phone as Key"
        helper="Scan the QR code with the Adyton app on your phone"
      >
        <template #action>
          <UButton
            color="neutral"
            variant="ghost"
            size="md"
            icon="i-lucide-x"
            aria-label="Cancel enrollment"
            class="flex-1 justify-center sm:flex-none"
            @click="cancel"
          >
            <span class="hidden sm:inline">Cancel</span>
          </UButton>
        </template>
      </SettingRow>
      <div class="border-t border-default px-4 py-4 flex flex-col items-center gap-3">
        <canvas
          ref="canvasEl"
          class="rounded-md"
          aria-label="PAK enrollment QR code — scan with your phone"
        />
        <div class="flex items-center gap-2 text-xs text-muted">
          <span class="size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          Waiting for phone to connect…
        </div>
      </div>
    </template>

    <!-- phone-connected: phone scanned, waiting for master password -->
    <template v-else-if="phase === 'phone-connected' || phase === 'confirming' || phase === 'sending'">
      <SettingRow
        label="Phone as Key"
        helper="Phone connected. Enter your master password to send the vault key."
        dot="bg-success"
      />
      <div class="border-t border-default px-4 py-3">
        <UFormField label="Master password" class="mb-3">
          <UInput
            v-model="masterPassword"
            type="password"
            size="lg"
            class="w-full"
            placeholder="Master password"
            :disabled="phase === 'confirming' || phase === 'sending'"
            autocomplete="current-password"
          />
        </UFormField>
        <div class="flex gap-2">
          <UButton
            color="primary"
            size="md"
            class="flex-1 justify-center"
            :loading="phase === 'confirming' || phase === 'sending'"
            :disabled="!masterPassword"
            @click="handleConfirm"
          >
            Confirm &amp; send
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="md"
            :disabled="phase === 'confirming' || phase === 'sending'"
            @click="cancel"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </template>

    <!-- recovery-kit-pending / finalizing: user must write down 24 words before enrollment completes -->
    <template v-else-if="phase === 'recovery-kit-pending' || phase === 'finalizing'">
      <SettingRow
        label="Phone as Key"
        helper="Save your recovery kit before completing enrollment"
        dot="bg-warning"
      />
      <div class="border-t border-default px-4 py-4">
        <RecoveryKitSetupStep
          v-if="pendingMnemonic"
          :mnemonic="pendingMnemonic"
          :loading="phase === 'finalizing'"
          @confirm="finalizeEnrollment"
        />
      </div>
    </template>

    <!-- enrolled: success -->
    <SettingRow
      v-else-if="phase === 'enrolled'"
      label="Phone as Key"
      helper="Phone enrolled successfully. You can now unlock the vault by scanning a QR code."
      dot="bg-success"
    >
      <template #action>
        <UButton
          color="neutral"
          variant="subtle"
          size="md"
          icon="i-lucide-plus"
          aria-label="Enroll another phone"
          class="flex-1 justify-center sm:flex-none"
          @click="reset"
        >
          <span class="hidden sm:inline">Enroll another</span>
        </UButton>
      </template>
    </SettingRow>

    <!-- error -->
    <template v-else-if="phase === 'error'">
      <SettingRow label="Phone as Key" helper="Enrollment failed">
        <template #action>
          <UButton
            color="neutral"
            variant="subtle"
            size="md"
            icon="i-lucide-rotate-ccw"
            aria-label="Reset enrollment"
            class="flex-1 justify-center sm:flex-none"
            @click="reset"
          >
            <span class="hidden sm:inline">Try again</span>
          </UButton>
        </template>
      </SettingRow>
      <div v-if="error" class="border-t border-default px-4 py-3">
        <UAlert color="error" :description="error" />
      </div>
    </template>
  </template>
</template>
