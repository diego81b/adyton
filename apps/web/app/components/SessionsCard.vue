<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { describeUserAgent, relativeTime, type ApiSession } from '~/utils/account';
import SettingsGroup from './SettingsGroup.vue';

// Active refresh-token sessions. NOTE: the API cannot tell which row is the caller's
// own session (the refresh cookie is scoped to /api/auth), so no "this device" badge —
// revoking your own session signs this device out at the next token refresh.
const auth = useAuthStore();
const toast = useToast();

const sessions = ref<ApiSession[]>([]);
const loading = ref(false);
const confirmId = ref<string | null>(null);
const confirmAllOpen = ref(false);
const revoking = ref(false);

async function load() {
  loading.value = true;
  try {
    sessions.value = await auth.apiFetch<ApiSession[]>('/sessions');
  } catch {
    toast.add({ title: 'Could not load sessions', color: 'error' });
  } finally {
    loading.value = false;
  }
}

async function revoke(id: string) {
  revoking.value = true;
  try {
    await auth.apiFetch(`/sessions/${id}`, { method: 'DELETE' });
    sessions.value = sessions.value.filter((s) => s.id !== id);
    toast.add({ title: 'Session revoked', color: 'success' });
  } catch {
    toast.add({ title: 'Revoke failed', color: 'error' });
  } finally {
    revoking.value = false;
    confirmId.value = null;
  }
}

// No bulk endpoint — revoke sequentially. Failures keep their rows.
async function revokeAll() {
  revoking.value = true;
  const targets = [...sessions.value];
  let failures = 0;
  for (const s of targets) {
    try {
      await auth.apiFetch(`/sessions/${s.id}`, { method: 'DELETE' });
      sessions.value = sessions.value.filter((x) => x.id !== s.id);
    } catch {
      failures += 1;
    }
  }
  revoking.value = false;
  confirmAllOpen.value = false;
  toast.add(
    failures === 0
      ? { title: 'All sessions revoked', color: 'success' }
      : { title: `${failures} session(s) could not be revoked`, color: 'error' },
  );
}

onMounted(load);
</script>

<template>
  <SettingsGroup title="Active sessions" :subtitle="`${sessions.length} active`">
    <div v-if="loading" class="px-4 py-6 text-center text-sm text-muted">Loading…</div>
    <div v-else-if="sessions.length === 0" class="px-4 py-6 text-center text-sm text-muted">
      No active sessions
    </div>
    <template v-else>
      <!-- flex-wrap: the right cluster (IP · time · Revoke) drops below the device
           name on narrow widths instead of squeezing Revoke out of the row. -->
      <div
        v-for="s in sessions.slice(0, 5)"
        :key="s.id"
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <UIcon name="i-lucide-monitor" class="size-4 shrink-0 text-dimmed" />
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-default">
              {{ describeUserAgent(s.userAgent) }}
            </div>
            <div class="text-[11px] text-dimmed">expires {{ relativeTime(s.expiresAt) }}</div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <span class="hidden font-mono text-[13px] tabular-nums text-muted sm:inline">{{ s.ipAddress }}</span>
          <span class="text-[13px] tabular-nums text-dimmed">{{ relativeTime(s.createdAt) }}</span>
          <UButton
            color="error"
            variant="ghost"
            size="sm"
            icon="i-lucide-shield-off"
            :aria-label="`Revoke session ${describeUserAgent(s.userAgent)}`"
            @click="confirmId = s.id"
          >
            <span class="hidden sm:inline">Revoke</span>
          </UButton>
        </div>
      </div>

      <div v-if="sessions.length > 5" class="px-4 py-2 text-[13px] text-dimmed">
        Showing 5 of {{ sessions.length }} sessions
      </div>

      <div v-if="sessions.length > 1" class="p-3">
        <UButton
          color="error"
          variant="subtle"
          size="sm"
          icon="i-lucide-shield-off"
          class="w-full justify-center"
          @click="confirmAllOpen = true"
        >
          Revoke all sessions
        </UButton>
      </div>
    </template>
  </SettingsGroup>

  <ConfirmDialog
      :open="confirmId !== null"
      title="Revoke this session?"
      message="The device will be signed out immediately and will need to sign in again to access the vault."
      confirm-label="Revoke"
      :loading="revoking"
      @update:open="(v: boolean) => { if (!v) confirmId = null; }"
      @confirm="confirmId && revoke(confirmId)"
    />
    <ConfirmDialog
      v-model:open="confirmAllOpen"
      title="Revoke all sessions?"
      message="Every device — including this one — will be signed out. Continue?"
      confirm-label="Revoke all"
      :loading="revoking"
      @confirm="revokeAll"
    />
</template>
