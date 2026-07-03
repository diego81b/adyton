<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import QRCode from 'qrcode';
import type { QrPhase } from '~/composables/usePakQrLogin';

const props = defineProps<{
  qrUrl: string | null;
  phase: QrPhase;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'retry'): void;
}>();

const canvasEl = ref<HTMLCanvasElement | null>(null);

watchEffect(() => {
  // Reading canvasEl.value inside the effect makes it track mount/unmount.
  if (!canvasEl.value || !props.qrUrl) return;
  QRCode.toCanvas(canvasEl.value, props.qrUrl, {
    width: 260,
    margin: 4,
    // The relay payload (ECDH pubkey + challenge + session id, base64-encoded) is
    // large enough to need ~QR version 11-13 — 'L' keeps the module count (and thus
    // module size at a fixed canvas width) as low as the data allows, since this
    // code is only ever screen-displayed and re-generated per session (no print
    // durability need for 'M'/'Q'). Margin bumped to the spec-recommended 4-module
    // quiet zone — both changes target reported camera-autofocus difficulty.
    errorCorrectionLevel: 'L',
    color: { dark: '#011a1f', light: '#f8fafb' },
  }).catch(() => {
    // QR render error — silently ignore (canvas stays blank)
  });
});
</script>

<template>
  <div class="rounded-lg border border-default bg-elevated p-5 text-center">
    <!-- Starting: generating session -->
    <template v-if="phase === 'starting'">
      <div class="flex flex-col items-center gap-3 py-4">
        <UIcon name="i-lucide-refresh-cw" class="size-8 animate-spin text-primary" aria-hidden="true" />
        <p class="text-sm text-muted">Generating secure session…</p>
      </div>
    </template>

    <!-- Pending: show QR code -->
    <template v-else-if="phase === 'pending'">
      <div class="flex flex-col items-center gap-4">
        <canvas ref="canvasEl" class="rounded-md" aria-label="PAK QR code — scan with your phone" />
        <p class="max-w-[220px] text-sm text-muted">
          Open Adyton on your phone and scan this code
        </p>
        <div class="flex items-center gap-2 text-xs text-muted">
          <span
            class="size-2 animate-pulse rounded-full bg-primary"
            aria-hidden="true"
          />
          Waiting for phone…
        </div>
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          aria-label="Cancel phone unlock"
          @click="emit('cancel')"
        >
          <span class="hidden sm:inline">Cancel</span>
          <span class="sm:hidden" aria-hidden="true">Cancel</span>
        </UButton>
      </div>
    </template>

    <!-- Approved: success state -->
    <template v-else-if="phase === 'approved'">
      <div class="flex flex-col items-center gap-3 py-4">
        <UIcon name="i-lucide-check-circle" class="size-8 text-success" aria-hidden="true" />
        <p class="text-sm text-muted">Vault key received. Opening vault…</p>
      </div>
    </template>

    <!-- Expired -->
    <template v-else-if="phase === 'expired'">
      <div class="flex flex-col items-center gap-4 py-4">
        <UIcon name="i-lucide-clock" class="size-8 text-warning" aria-hidden="true" />
        <p class="text-sm text-default">Session expired. Scan a new QR code.</p>
        <div class="flex gap-2">
          <UButton size="sm" color="primary" variant="subtle" aria-label="Try again" @click="emit('retry')">
            Try again
          </UButton>
          <UButton size="sm" color="neutral" variant="ghost" aria-label="Cancel" @click="emit('cancel')">
            Cancel
          </UButton>
        </div>
      </div>
    </template>

    <!-- Denied -->
    <template v-else-if="phase === 'denied'">
      <div class="flex flex-col items-center gap-4 py-4">
        <UIcon name="i-lucide-x-circle" class="size-8 text-error" aria-hidden="true" />
        <p class="text-sm text-default">Phone denied this request.</p>
        <div class="flex gap-2">
          <UButton size="sm" color="primary" variant="subtle" aria-label="Try again" @click="emit('retry')">
            Try again
          </UButton>
          <UButton size="sm" color="neutral" variant="ghost" aria-label="Cancel" @click="emit('cancel')">
            Cancel
          </UButton>
        </div>
      </div>
    </template>

    <!-- Error -->
    <template v-else-if="phase === 'error'">
      <div class="flex flex-col items-center gap-4 py-2">
        <UAlert color="error" variant="soft" :description="error ?? 'An unexpected error occurred.'" />
        <div class="flex gap-2">
          <UButton size="sm" color="primary" variant="subtle" aria-label="Try again" @click="emit('retry')">
            Try again
          </UButton>
          <UButton size="sm" color="neutral" variant="ghost" aria-label="Cancel" @click="emit('cancel')">
            Cancel
          </UButton>
        </div>
      </div>
    </template>
  </div>
</template>
