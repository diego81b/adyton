<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { describeUserAgent, relativeTime, type ApiTrustedDevice } from '~/utils/account';
import SettingsGroup from './SettingsGroup.vue';

const auth = useAuthStore();
const toast = useToast();

const devices = ref<ApiTrustedDevice[]>([]);
const loading = ref(false);
const confirmId = ref<string | null>(null);
const revoking = ref(false);

async function load() {
  loading.value = true;
  try {
    devices.value = await auth.apiFetch<ApiTrustedDevice[]>('/devices');
  } catch {
    toast.add({ title: 'Could not load trusted devices', color: 'error' });
  } finally {
    loading.value = false;
  }
}

async function revoke(id: string) {
  revoking.value = true;
  try {
    await auth.apiFetch(`/devices/${id}`, { method: 'DELETE' });
    devices.value = devices.value.filter((d) => d.id !== id);
    toast.add({ title: 'Device trust revoked', color: 'success' });
  } catch {
    toast.add({ title: 'Revoke failed', color: 'error' });
  } finally {
    revoking.value = false;
    confirmId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <SettingsGroup title="Trusted devices" :subtitle="`${devices.length} trusted`">
    <div v-if="loading" class="px-3 py-6 text-center text-sm text-muted">Loading…</div>
    <div v-else-if="devices.length === 0" class="px-3 py-6 text-center text-sm text-muted">
      No trusted devices
    </div>
    <template v-else>
      <div
        v-for="d in devices"
        :key="d.id"
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <UIcon name="i-lucide-smartphone" class="size-4 shrink-0 text-dimmed" />
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-default">
              {{ describeUserAgent(d.userAgent) }}
            </div>
            <div class="text-[11px] text-dimmed">
              trusted {{ relativeTime(d.createdAt) }} · last seen {{ relativeTime(d.lastSeenAt) }}
            </div>
          </div>
        </div>
        <UButton
          color="error"
          variant="subtle"
          size="sm"
          icon="i-lucide-shield-off"
          class="shrink-0"
          :aria-label="`Revoke trust from ${describeUserAgent(d.userAgent)}`"
          @click="confirmId = d.id"
        />
      </div>
    </template>
  </SettingsGroup>

  <ConfirmDialog
    :open="confirmId !== null"
    title="Remove trust from this device?"
    message="The device will require verification at the next sign-in. Do this if the device is lost or compromised."
    confirm-label="Revoke trust"
    :loading="revoking"
    @update:open="(v: boolean) => { if (!v) confirmId = null; }"
    @confirm="confirmId && revoke(confirmId)"
  />
</template>
