<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useWebAuthn, type PasskeySummary } from '~/composables/useWebAuthn';
import { relativeTime } from '~/utils/account';
import ConfirmDialog from './ConfirmDialog.vue';

// Account-level passkey (WebAuthn) management. Passkeys ride on top of TOTP — the API
// rejects registration until 2FA is enabled, so the card mirrors that: it only loads
// and only allows adding when `user.totpEnabled` is true and the browser supports
// WebAuthn. This card owns every request; the composable owns the ceremony.
const auth = useAuthStore();
const toast = useToast();
const { supported, registerPasskey } = useWebAuthn();

const totpEnabled = computed(() => auth.user?.totpEnabled ?? false);
const canManage = computed(() => totpEnabled.value && supported.value);

const passkeys = ref<PasskeySummary[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    passkeys.value = await auth.apiFetch<PasskeySummary[]>('/auth/webauthn/credentials');
  } catch {
    toast.add({ title: 'Could not load passkeys', color: 'error' });
  } finally {
    loading.value = false;
  }
}

// --- Add flow ----------------------------------------------------------------
const adding = ref(false); // inline name form open
const friendlyName = ref('');
const registering = ref(false);

const nameValid = computed(() => friendlyName.value.trim().length > 0);

function openAdd() {
  friendlyName.value = '';
  adding.value = true;
}

function cancelAdd() {
  adding.value = false;
  friendlyName.value = '';
}

async function confirmAdd() {
  if (!nameValid.value || registering.value) return;
  registering.value = true;
  try {
    const summary = await registerPasskey(friendlyName.value.trim());
    passkeys.value = [...passkeys.value, summary];
    adding.value = false;
    friendlyName.value = '';
    toast.add({ title: 'Passkey added', color: 'success' });
  } catch (err) {
    toast.add({
      title: err instanceof Error ? err.message : 'Could not add passkey',
      color: 'error',
    });
  } finally {
    registering.value = false;
  }
}

// --- Remove flow -------------------------------------------------------------
const removeId = ref<string | null>(null);
const removing = ref(false);

const removeTarget = computed(() =>
  passkeys.value.find((p) => p.id === removeId.value) ?? null,
);

async function confirmRemove() {
  if (!removeId.value) return;
  removing.value = true;
  try {
    await auth.apiFetch(`/auth/webauthn/credentials/${removeId.value}`, { method: 'DELETE' });
    passkeys.value = passkeys.value.filter((p) => p.id !== removeId.value);
    toast.add({ title: 'Passkey removed', color: 'success' });
  } catch {
    toast.add({ title: 'Remove failed', color: 'error' });
  } finally {
    removing.value = false;
    removeId.value = null;
  }
}

function formatAdded(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Only fetch when the account can actually have passkeys — saves a guaranteed 400.
// watch with immediate covers both mount and 2FA being enabled later in-session
// (TwoFactorCard flips user.totpEnabled without a reload).
watch(canManage, (can) => {
  if (can) load();
}, { immediate: true });
</script>

<template>
  <div class="rounded-2xl border border-default bg-elevated p-4">
    <div class="mb-0.5 flex items-center gap-2">
      <h3 class="text-sm font-semibold">Passkeys</h3>
      <span
        v-if="canManage && passkeys.length"
        class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300"
      >
        {{ passkeys.length }}
      </span>
    </div>
    <p class="text-[11px] text-muted">
      Sign in with a hardware key, fingerprint, or device PIN.
    </p>

    <!-- Gating hints: TOTP required first, then browser support. -->
    <p
      v-if="!totpEnabled"
      class="mt-3 rounded-lg border border-default bg-accented px-3 py-2 text-[11px] text-muted"
    >
      Enable two-factor authentication first.
    </p>
    <p
      v-else-if="!supported"
      class="mt-3 rounded-lg border border-default bg-accented px-3 py-2 text-[11px] text-muted"
    >
      This browser does not support passkeys.
    </p>

    <!-- Credential list -->
    <template v-else>
      <div v-if="loading" class="mt-3 text-xs text-muted">Loading…</div>
      <ul v-else-if="passkeys.length" class="mt-3 divide-y divide-default">
        <li
          v-for="key in passkeys"
          :key="key.id"
          class="flex items-center justify-between gap-3 py-2.5"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <UIcon name="i-lucide-key-round" class="size-4 shrink-0 text-muted" />
            <div class="min-w-0">
              <div class="truncate text-xs font-semibold text-highlighted">
                {{ key.friendlyName }}
              </div>
              <div class="text-[10px] text-dimmed">
                Added {{ formatAdded(key.createdAt) }} · Last used {{ relativeTime(key.lastUsedAt) }}
              </div>
            </div>
          </div>
          <UButton
            color="error"
            variant="subtle"
            size="xs"
            icon="i-lucide-trash-2"
            :aria-label="`Remove passkey ${key.friendlyName}`"
            @click="removeId = key.id"
          >
            <span class="hidden sm:inline">Remove</span>
          </UButton>
        </li>
      </ul>
      <p v-else class="mt-3 text-xs text-muted">No passkeys yet.</p>

      <!-- Inline add form -->
      <div v-if="adding" class="mt-3 space-y-2">
        <UInput
          v-model="friendlyName"
          size="lg"
          class="w-full"
          placeholder="e.g. YubiKey, MacBook Touch ID"
          :maxlength="64"
          autofocus
          @keydown.enter.prevent="confirmAdd"
        />
        <div class="flex gap-2">
          <UButton
            color="primary"
            variant="subtle"
            size="sm"
            :loading="registering"
            :disabled="!nameValid"
            @click="confirmAdd"
          >
            Create passkey
          </UButton>
          <UButton color="neutral" variant="soft" size="sm" :disabled="registering" @click="cancelAdd">
            Cancel
          </UButton>
        </div>
      </div>
      <UButton
        v-else
        color="primary"
        variant="subtle"
        size="sm"
        icon="i-lucide-plus"
        aria-label="Add passkey"
        class="mt-4"
        @click="openAdd"
      >
        <span class="hidden sm:inline">Add passkey</span>
      </UButton>
    </template>

    <ConfirmDialog
      :open="removeId !== null"
      title="Remove this passkey?"
      :message="removeTarget
        ? `“${removeTarget.friendlyName}” will no longer be usable to sign in. This cannot be undone.`
        : ''"
      confirm-label="Remove"
      :loading="removing"
      @update:open="(v: boolean) => { if (!v) removeId = null; }"
      @confirm="confirmRemove"
    />
  </div>
</template>
