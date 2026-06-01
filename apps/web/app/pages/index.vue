<script setup lang="ts">
definePageMeta({ ssr: false });
const router = useRouter();
onMounted(() => router.replace('/login'));
</script>

<template>
  <div />
</template>
