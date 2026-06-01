<script setup lang="ts">
definePageMeta({ ssr: false });
const router = useRouter();
onMounted(() => router.replace('/vault'));
</script>

<template>
  <div />
</template>
