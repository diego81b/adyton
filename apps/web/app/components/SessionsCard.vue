<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { describeUserAgent, relativeTime, type ApiSession } from '~/utils/account';

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
  <div class="rounded-2xl border border-default bg-elevated">
    <div class="flex items-center justify-between px-4 pb-3 pt-4">
      <div>
        <h3 class="text-sm font-semibold">Active sessions</h3>
        <p class="mt-0.5 text-[11px] text-muted">
          Revoking this device's session signs you out
        </p>
      </div>
      <span class="font-mono text-[10px] text-dimmed">{{ sessions.length }} active</span>
    </div>

    <div class="border-t border-default">
      <div v-if="loading" class="px-4 py-6 text-center text-xs text-muted">Loading…</div>
      <div v-else-if="sessions.length === 0" class="px-4 py-6 text-center text-xs text-muted">
        No active sessions
      </div>
      <div v-else class="divide-y divide-default">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="gap-3 px-4 py-3 sm:grid sm:grid-cols-[1fr_130px_110px_auto] sm:items-center"
        >
          <div class="mb-1 flex items-center gap-2.5 sm:mb-0">
            <UIcon name="i-lucide-monitor" class="size-4 shrink-0 text-muted" />
            <div class="min-w-0">
              <div class="truncate text-xs font-semibold text-highlighted">
                {{ describeUserAgent(s.userAgent) }}
              </div>
              <div class="text-[10px] text-dimmed">expires {{ relativeTime(s.expiresAt) }}</div>
            </div>
          </div>
          <div class="font-mono text-xs text-muted">{{ s.ipAddress }}</div>
          <div class="text-xs text-muted">{{ relativeTime(s.createdAt) }}</div>
          <div class="sm:text-right">
            <UButton
              color="error"
              variant="subtle"
              size="xs"
              :aria-label="`Revoke session ${describeUserAgent(s.userAgent)}`"
              @click="confirmId = s.id"
            >
              Revoke
            </UButton>
          </div>
        </div>
      </div>

      <div v-if="sessions.length > 1" class="border-t border-default p-3">
        <UButton
          color="error"
          variant="subtle"
          size="sm"
          class="w-full justify-center"
          @click="confirmAllOpen = true"
        >
          Revoke all sessions
        </UButton>
      </div>
    </div>

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
  </div>
</template>
