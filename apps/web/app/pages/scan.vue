<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNativeRuntime } from '~/composables/useNativeRuntime';

// No layout: the camera preview needs the whole viewport transparent behind the
// overlay, with no persistent nav chrome competing for the same screen space.
definePageMeta({ ssr: false, layout: false });

const router = useRouter();
const { isNative } = useNativeRuntime();

onMounted(() => {
  // The nav item is native-only, but the route itself is still reachable by typed
  // URL on web builds — bounce back, there is no camera use case in a browser tab.
  if (!isNative) {
    router.push('/vault');
  }
});
</script>

<template>
  <QrScannerOverlay v-if="isNative" />
</template>
