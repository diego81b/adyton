<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useSettingsStore } from '~/stores/settings';
import { useAppChrome } from '~/composables/useAppChrome';

definePageMeta({ ssr: false, layout: 'vault', middleware: 'auth' });

const auth = useAuthStore();
const settings = useSettingsStore();
const toast = useToast();
const router = useRouter();
const { setChrome } = useAppChrome();

onMounted(() => setChrome({ title: 'Settings', subtitle: 'Account, security, and data' }));

// --- Account ----------------------------------------------------------------
const displayNameDraft = ref(settings.displayName);
const savingName = ref(false);

// Server fetch may land after mount — adopt the authoritative value unless the
// user already started editing the field.
watch(
  () => settings.displayName,
  (next, prev) => {
    if (displayNameDraft.value === prev) displayNameDraft.value = next;
  },
);

async function saveDisplayName() {
  savingName.value = true;
  try {
    await settings.updateSettings({ displayName: displayNameDraft.value.trim() });
    toast.add({ title: 'Display name saved', color: 'success' });
  } catch {
    toast.add({ title: 'Save failed', color: 'error' });
  } finally {
    savingName.value = false;
  }
}

// --- Danger zone --------------------------------------------------------------
const deleteOpen = ref(false);

async function onDeleted() {
  // The account row is gone server-side; clear all client state and leave.
  await auth.logout().catch(() => {});
  toast.add({ title: 'Account deleted', color: 'success' });
  router.push('/login');
}

</script>

<template>
  <!-- Two balanced columns on desktop (static account/vault prefs left, growing
       security lists right), single column on mobile in the natural order; the
       danger zone always spans full width at the bottom. -->
  <div class="mx-auto w-full max-w-5xl">
    <div class="lg:grid lg:grid-cols-2 lg:gap-8 space-y-8 lg:space-y-0">
      <div class="min-w-0 space-y-8">
        <!-- ============== ACCOUNT ============== -->
        <SettingsSection id="settings-account" title="Account" icon="i-lucide-user">
        <div class="divide-y divide-default rounded-2xl border border-default bg-elevated">
          <div class="p-4">
            <label class="block">
              <span class="text-xs font-medium text-toned">Display name</span>
              <p class="mb-2 text-[11px] text-muted">Shown in the avatar — synced across devices</p>
              <div class="flex gap-2">
                <UInput
                  v-model="displayNameDraft"
                  size="lg"
                  class="flex-1"
                  placeholder="Your name"
                  :maxlength="64"
                />
                <UButton
                  color="neutral"
                  variant="subtle"
                  size="lg"
                  :loading="savingName"
                  :disabled="displayNameDraft.trim() === settings.displayName"
                  @click="saveDisplayName"
                >
                  Save
                </UButton>
              </div>
            </label>
          </div>

          <div class="p-4">
            <span class="text-xs font-medium text-toned">Email</span>
            <p class="mb-2 text-[11px] text-muted">Used for sign-in · cannot be changed in V1</p>
            <p class="font-mono text-sm text-highlighted">{{ auth.user?.email }}</p>
          </div>

          <div class="flex items-center justify-between gap-3 p-4">
            <div class="min-w-0">
              <div class="text-xs font-medium text-toned">Master password</div>
              <p class="mt-0.5 text-[11px] text-muted">
                Changing re-encrypts your entire vault — available in a later release
              </p>
            </div>
            <UButton color="neutral" variant="subtle" size="sm" disabled>Change</UButton>
          </div>
        </div>
        </SettingsSection>

        <!-- ============== VAULT (auto-lock) ============== -->
        <SettingsSection id="settings-vault" title="Vault" icon="i-lucide-lock">
          <AutoLockCard />
        </SettingsSection>

        <!-- ============== DANGER ZONE ============== -->
        <SettingsSection id="settings-danger" title="Danger zone" icon="i-lucide-triangle-alert" danger>
          <div class="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-rose-300">Delete account</h3>
                <p class="mt-0.5 text-[11px] text-muted">
                  Permanently removes your account and every encrypted entry. Irreversible.
                </p>
              </div>
              <UButton color="error" variant="subtle" size="sm" @click="deleteOpen = true">
                Delete account
              </UButton>
            </div>
          </div>
        </SettingsSection>
      </div>

      <div class="min-w-0 space-y-8">
        <!-- ============== SECURITY ============== -->
        <SettingsSection id="settings-security" title="Security" icon="i-lucide-shield">
          <div class="space-y-4">
            <TwoFactorCard />

            <SessionsCard />
            <TrustedDevicesCard />
          </div>
        </SettingsSection>
      </div>
    </div>

    <DeleteAccountModal v-model="deleteOpen" @deleted="onDeleted" />
  </div>
</template>
