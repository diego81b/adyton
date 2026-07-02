<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { usePakDevices } from '~/composables/usePakDevices';
import { usePakSelfRevoke } from '~/composables/usePakSelfRevoke';
import { useNativeRuntime } from '~/composables/useNativeRuntime';
import { useAuthStore } from '~/stores/auth';
import { relativeTime } from '~/utils/account';
import SettingsGroup from './SettingsGroup.vue';
import SettingRow from './SettingRow.vue';

const { isNative } = useNativeRuntime();
const auth = useAuthStore();
const { devices, loading, error, fetchDevices, renameDevice, revokeDevice } = usePakDevices();
const selfRevoke = usePakSelfRevoke();
const isPakEnrolled = ref(false);

// Rename state — one device at a time
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameLoading = ref(false);

// Revoke modal state
const revokeTarget = ref<{ id: string; name: string } | null>(null);
const revokeReason = ref<'safe' | 'compromised'>('safe');
const revokeLoading = ref(false);

function formatEnrolledDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(d);
}

function platformLabel(platform: string): string {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iOS';
  return platform;
}

function deviceSubtitle(count: number): string {
  if (count === 0) return '';
  if (count === 1) return '1 key enrolled';
  return `${count} keys enrolled`;
}

function startRename(id: string, currentName: string) {
  renamingId.value = id;
  renameValue.value = currentName;
}

function cancelRename() {
  renamingId.value = null;
  renameValue.value = '';
}

async function submitRename() {
  if (!renamingId.value || !renameValue.value.trim()) return;
  renameLoading.value = true;
  try {
    await renameDevice(renamingId.value, renameValue.value.trim());
    renamingId.value = null;
    renameValue.value = '';
  } finally {
    renameLoading.value = false;
  }
}

function openRevoke(id: string, name: string) {
  revokeTarget.value = { id, name };
  revokeReason.value = 'safe';
}

function closeRevoke() {
  revokeTarget.value = null;
}

async function confirmRevoke() {
  if (!revokeTarget.value) return;
  revokeLoading.value = true;
  try {
    await revokeDevice(revokeTarget.value.id, revokeReason.value);
    revokeTarget.value = null;
  } finally {
    revokeLoading.value = false;
  }
}

async function handleSelfRevoke() {
  const userId = auth.user?.id ?? '';
  try {
    const ok = await selfRevoke.revokeThisDevice(userId);
    if (ok) isPakEnrolled.value = false;
  } catch {
    // error already set in selfRevoke.error
  }
}

onMounted(async () => {
  if (!isNative) {
    void fetchDevices();
  } else {
    isPakEnrolled.value = await selfRevoke.isPakDevice(auth.user?.id ?? '');
  }
});

defineExpose({ refresh: fetchDevices });
</script>

<template>
  <!-- Desktop: full device list. Native: self-revoke for this device. -->
  <template v-if="!isNative">
    <SettingsGroup
      title="Phone keys"
      :subtitle="deviceSubtitle(devices.length)"
    >
      <!-- Loading initial fetch -->
      <div v-if="loading && devices.length === 0" class="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" aria-label="Loading phone keys" />
        Loading…
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="px-3 py-3">
        <UAlert color="error" :description="error" aria-label="Error loading phone keys" />
        <div class="mt-2 flex justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-rotate-ccw"
            aria-label="Retry loading phone keys"
            @click="fetchDevices"
          >
            <span class="hidden sm:inline">Retry</span>
          </UButton>
        </div>
      </div>

      <!-- Empty state -->
      <SettingRow
        v-else-if="!loading && devices.length === 0"
        label="No phone keys enrolled"
        helper="Use the enrollment wizard above to register your phone"
      />

      <!-- Device rows -->
      <template v-else>
        <SettingRow
          v-for="device in devices"
          :key="device.id"
          :label="renamingId === device.id ? '' : device.deviceName"
          :value="renamingId === device.id ? undefined : `${platformLabel(device.platform)} · Enrolled ${formatEnrolledDate(device.enrolledAt)}`"
          :helper="renamingId === device.id ? undefined : (device.lastUsedAt ? `Last used: ${relativeTime(device.lastUsedAt)}` : 'Last used: never')"
        >
          <template v-if="renamingId === device.id" #action>
            <!-- Inline rename form -->
            <div class="flex w-full items-center gap-2">
              <UInput
                v-model="renameValue"
                size="sm"
                class="w-full min-w-0"
                :placeholder="device.deviceName"
                :disabled="renameLoading"
                aria-label="New device name"
                @keyup.enter="submitRename"
                @keyup.escape="cancelRename"
              />
              <UButton
                color="primary"
                size="sm"
                icon="i-lucide-check"
                aria-label="Save device name"
                :loading="renameLoading"
                :disabled="!renameValue.trim()"
                @click="submitRename"
              >
                <span class="hidden sm:inline">Save</span>
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-x"
                aria-label="Cancel rename"
                :disabled="renameLoading"
                @click="cancelRename"
              >
                <span class="hidden sm:inline">Cancel</span>
              </UButton>
            </div>
          </template>
          <template v-else #action>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-pencil"
              :aria-label="`Rename ${device.deviceName}`"
              class="shrink-0"
              @click="startRename(device.id, device.deviceName)"
            >
              <span class="hidden sm:inline">Rename</span>
            </UButton>
            <UButton
              color="error"
              variant="subtle"
              size="sm"
              icon="i-lucide-trash-2"
              :aria-label="`Revoke ${device.deviceName}`"
              class="shrink-0"
              @click="openRevoke(device.id, device.deviceName)"
            >
              <span class="hidden sm:inline">Revoke</span>
            </UButton>
          </template>
        </SettingRow>
      </template>
    </SettingsGroup>

    <!-- Revoke confirmation modal -->
    <UModal
      :open="revokeTarget !== null"
      :title="`Revoke ${revokeTarget?.name ?? ''}?`"
      @update:open="(v: boolean) => { if (!v) closeRevoke(); }"
    >
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-center gap-2.5">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/15">
              <UIcon name="i-lucide-triangle-alert" class="size-4 text-rose-600 dark:text-rose-400" />
            </div>
            <h2 class="font-bold tracking-tight">Revoke {{ revokeTarget?.name ?? '' }}?</h2>
          </div>

          <!-- Reason selector -->
          <div class="space-y-2">
            <label class="flex cursor-pointer items-start gap-2.5">
              <input
                v-model="revokeReason"
                type="radio"
                value="safe"
                class="mt-0.5 shrink-0 accent-current"
              />
              <div>
                <div class="text-sm font-medium text-default">Safe decommission</div>
                <p class="text-xs text-muted">The device is being retired normally. It will no longer be able to authenticate.</p>
              </div>
            </label>
            <label class="flex cursor-pointer items-start gap-2.5">
              <input
                v-model="revokeReason"
                type="radio"
                value="compromised"
                class="mt-0.5 shrink-0 accent-current"
              />
              <div>
                <div class="text-sm font-medium text-default">Compromised</div>
                <p class="text-xs text-muted">The device may be in hostile hands.</p>
              </div>
            </label>
          </div>

          <!-- Compromised warning -->
          <UAlert
            v-if="revokeReason === 'compromised'"
            color="warning"
            description="The device still holds a sealed copy of your vault key. It is blocked from server access but can still open the vault locally if bypassed. Consider changing your master password."
          />

          <div class="flex gap-2 pt-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="lg"
              class="flex-1 justify-center"
              :disabled="revokeLoading"
              @click="closeRevoke"
            >
              Cancel
            </UButton>
            <UButton
              color="error"
              size="lg"
              class="flex-1 justify-center"
              :loading="revokeLoading"
              @click="confirmRevoke"
            >
              Revoke
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </template>

  <!-- Native: manage THIS device's PAK enrollment -->
  <template v-else>
    <SettingsGroup v-if="isPakEnrolled" title="Phone key" subtitle="This device">
      <SettingRow
        label="This device"
        helper="Enrolled as a phone key for vault access"
        dot="bg-success"
      >
        <template #action>
          <UButton
            color="error"
            variant="subtle"
            size="sm"
            icon="i-lucide-trash-2"
            aria-label="Remove this device as phone key"
            :loading="selfRevoke.loading.value"
            @click="handleSelfRevoke"
          >
            <span class="hidden sm:inline">Remove</span>
          </UButton>
        </template>
      </SettingRow>
      <div v-if="selfRevoke.error.value" class="px-3 py-3">
        <UAlert color="error" :description="selfRevoke.error.value" />
      </div>
    </SettingsGroup>
  </template>
</template>
