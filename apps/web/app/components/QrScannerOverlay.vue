<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BarcodeScanner,
  type BarcodesScannedEvent,
  type ScanErrorEvent,
} from '@capacitor-mlkit/barcode-scanning';
import type { PluginListenerHandle } from '@capacitor/core';
import { parsePakUrl } from '~/utils/pak-url';

const router = useRouter();

type State = 'checking' | 'denied' | 'scanning' | 'error';
const state = ref<State>('checking');
const errorMessage = ref<string | null>(null);
// ML Kit fires barcodesScanned repeatedly (~per frame) while a code stays in view —
// only re-surface the "not a phone-key QR" error when the scanned value actually
// changes, so a wrong code held in frame doesn't spam re-renders.
const lastRejectedValue = ref<string | null>(null);

let barcodesListener: PluginListenerHandle | undefined;
let scanErrorListener: PluginListenerHandle | undefined;
let scanning = false;

const TRANSPARENT_CLASS = 'qr-scanner-transparent';

function setTransparent(active: boolean) {
  for (const el of [document.documentElement, document.body]) {
    el.classList.toggle(TRANSPARENT_CLASS, active);
  }
}

async function stopScanning() {
  if (!scanning) return;
  scanning = false;
  try {
    await BarcodeScanner.stopScan();
  } catch {
    // Already stopped or plugin unavailable — nothing more to do.
  }
  setTransparent(false);
}

function onBarcodesScanned(event: BarcodesScannedEvent) {
  const rawValue = event.barcodes[0]?.rawValue;
  if (!rawValue) return;

  const route = parsePakUrl(rawValue);
  if (route) {
    lastRejectedValue.value = null;
    void stopScanning().then(() => router.push(route));
    return;
  }

  if (rawValue !== lastRejectedValue.value) {
    lastRejectedValue.value = rawValue;
    errorMessage.value = 'Not an Adyton phone-key QR code. Keep scanning or cancel.';
  }
}

function onScanError(event: ScanErrorEvent) {
  scanning = false;
  setTransparent(false);
  state.value = 'error';
  errorMessage.value = event.message;
}

async function startScanning() {
  try {
    barcodesListener = await BarcodeScanner.addListener('barcodesScanned', onBarcodesScanned);
    scanErrorListener = await BarcodeScanner.addListener('scanError', onScanError);
    setTransparent(true);
    scanning = true;
    await BarcodeScanner.startScan();
    state.value = 'scanning';
  } catch (err) {
    scanning = false;
    setTransparent(false);
    state.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : 'Could not start the camera.';
  }
}

async function requestAndStart() {
  state.value = 'checking';
  try {
    let status = await BarcodeScanner.checkPermissions();
    if (status.camera !== 'granted' && status.camera !== 'limited') {
      status = await BarcodeScanner.requestPermissions();
    }
    if (status.camera === 'granted' || status.camera === 'limited') {
      await startScanning();
    } else {
      state.value = 'denied';
    }
  } catch (err) {
    state.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : 'Camera permission check failed.';
  }
}

function retry() {
  errorMessage.value = null;
  void requestAndStart();
}

function openSettings() {
  void BarcodeScanner.openSettings();
}

function cancel() {
  void stopScanning();
  router.push('/vault');
}

onMounted(() => {
  void requestAndStart();
});

onUnmounted(() => {
  // Covers back-button/navigation away mid-scan — the most likely leak spot if
  // this only ran on explicit cancel.
  void stopScanning();
  void barcodesListener?.remove();
  void scanErrorListener?.remove();
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col">
    <div class="flex items-center justify-between p-4">
      <UButton
        icon="i-lucide-x"
        aria-label="Cancel scan"
        color="neutral"
        variant="soft"
        @click="cancel"
      >
        <span class="hidden sm:inline">Cancel</span>
      </UButton>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
      <template v-if="state === 'checking'">
        <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-white" aria-hidden="true" />
        <p class="text-sm text-white/80">Requesting camera access…</p>
      </template>

      <template v-else-if="state === 'denied'">
        <UIcon name="i-lucide-camera-off" class="size-10 text-white" aria-hidden="true" />
        <p class="text-sm text-white">Camera access is needed to scan a phone-key QR code.</p>
        <UButton color="primary" @click="openSettings">Open Settings</UButton>
        <UButton color="neutral" variant="ghost" @click="cancel">Cancel</UButton>
      </template>

      <template v-else-if="state === 'error'">
        <UIcon name="i-lucide-triangle-alert" class="size-10 text-white" aria-hidden="true" />
        <p class="text-sm text-white">{{ errorMessage }}</p>
        <UButton color="primary" @click="retry">Try Again</UButton>
        <UButton color="neutral" variant="ghost" @click="cancel">Cancel</UButton>
      </template>

      <template v-else>
        <div class="size-64 max-w-[70vw] max-h-[70vw] rounded-2xl border-2 border-white/80" />
        <p class="text-sm text-white/80">Point the camera at the PAK QR code</p>
        <UAlert
          v-if="errorMessage"
          color="warning"
          variant="soft"
          :description="errorMessage"
        />
      </template>
    </div>
  </div>
</template>
