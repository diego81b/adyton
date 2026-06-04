<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { describeUserAgent, relativeTime, type ApiTrustedDevice } from '~/utils/account';

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
  <div class="rounded-2xl border border-default bg-elevated">
    <div class="flex items-center justify-between px-4 pb-3 pt-4">
      <div>
        <h3 class="text-sm font-semibold">Trusted devices</h3>
        <p class="mt-0.5 text-[11px] text-muted">
          Skip new-device verification on these — revoke immediately if lost
        </p>
      </div>
      <span class="font-mono text-[10px] text-dimmed">{{ devices.length }} trusted</span>
    </div>

    <div class="border-t border-default">
      <div v-if="loading" class="px-4 py-6 text-center text-xs text-muted">Loading…</div>
      <div v-else-if="devices.length === 0" class="px-4 py-6 text-center text-xs text-muted">
        No trusted devices
      </div>
      <div v-else class="divide-y divide-default">
        <div v-for="d in devices" :key="d.id" class="flex items-center gap-3 px-4 py-3">
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-md border border-default bg-accented"
          >
            <UIcon name="i-lucide-smartphone" class="size-3.5 text-muted" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-highlighted">
              {{ describeUserAgent(d.userAgent) }}
            </div>
            <div class="text-[10px] text-dimmed">
              trusted {{ relativeTime(d.createdAt) }} · last seen {{ relativeTime(d.lastSeenAt) }}
            </div>
          </div>
          <UButton
            color="error"
            variant="subtle"
            size="xs"
            :aria-label="`Revoke trust from ${describeUserAgent(d.userAgent)}`"
            @click="confirmId = d.id"
          >
            Revoke
          </UButton>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="confirmId !== null"
      title="Remove trust from this device?"
      message="The device will require verification at the next sign-in. Do this if the device is lost or compromised."
      confirm-label="Revoke trust"
      :loading="revoking"
      @update:open="(v: boolean) => { if (!v) confirmId = null; }"
      @confirm="confirmId && revoke(confirmId)"
    />
  </div>
</template>
