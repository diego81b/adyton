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

const exportOpen = ref(false);
const importOpen = ref(false);

function onImported(count: number) {
  toast.add({ title: `Imported ${count} ${count === 1 ? 'entry' : 'entries'}`, color: 'success' });
}

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
  <!-- Single dense scroll (Swiss enterprise): quiet section headers over hairline
       divided rows. One content column so wide rows (sessions) never get squeezed. -->
  <div class="mx-auto w-full max-w-3xl space-y-8">
    <!-- ============== ACCOUNT ============== -->
    <SettingsGroup id="settings-account" title="Account">
      <SettingRow label="Display name" helper="Shown in your avatar · synced across devices">
        <template #action>
          <div class="flex items-center gap-2">
            <UInput
              v-model="displayNameDraft"
              size="md"
              class="w-40 sm:w-48"
              placeholder="Your name"
              :maxlength="64"
            />
            <UButton
              color="primary"
              variant="subtle"
              size="md"
              icon="i-lucide-check"
              aria-label="Save display name"
              :loading="savingName"
              :disabled="displayNameDraft.trim() === settings.displayName"
              @click="saveDisplayName"
            >
              <span class="hidden sm:inline">Save</span>
            </UButton>
          </div>
        </template>
      </SettingRow>

      <SettingRow
        label="Email"
        helper="Used for sign-in · cannot be changed in V1"
        :value="auth.user?.email"
        mono
      />

      <SettingRow label="Master password" helper="Changing re-encrypts your vault · available later">
        <template #action>
          <UButton
            color="neutral"
            variant="subtle"
            size="md"
            icon="i-lucide-key-round"
            aria-label="Change master password"
            disabled
          >
            <span class="hidden sm:inline">Change</span>
          </UButton>
        </template>
      </SettingRow>
    </SettingsGroup>

    <!-- ============== SECURITY ============== -->
    <SettingsGroup id="settings-security" title="Security">
      <TwoFactorCard />
      <BiometricUnlockCard />
    </SettingsGroup>

    <!-- Credential lists — each owns its group (dynamic count subtitle). -->
    <PasskeysCard />
    <SessionsCard />
    <TrustedDevicesCard />

    <!-- ============== VAULT ============== -->
    <SettingsGroup id="settings-vault" title="Vault">
      <AutoLockCard />
      <SettingRow label="Export vault" helper="Download an encrypted backup of all entries">
        <template #action>
          <UButton
            color="neutral"
            variant="subtle"
            size="md"
            icon="i-lucide-download"
            aria-label="Export vault"
            @click="exportOpen = true"
          >
            <span class="hidden sm:inline">Export</span>
          </UButton>
        </template>
      </SettingRow>
      <SettingRow label="Import vault" helper="Restore from a .adyton file · replaces current vault">
        <template #action>
          <UButton
            color="neutral"
            variant="subtle"
            size="md"
            icon="i-lucide-upload"
            aria-label="Import vault"
            @click="importOpen = true"
          >
            <span class="hidden sm:inline">Import</span>
          </UButton>
        </template>
      </SettingRow>
    </SettingsGroup>

    <!-- ============== APPEARANCE ============== -->
    <SettingsGroup id="settings-appearance" title="Appearance">
      <AppearanceCard />
    </SettingsGroup>

    <!-- ============== DANGER ZONE ============== -->
    <SettingsGroup id="settings-danger" title="Danger zone" danger>
      <SettingRow
        label="Delete account"
        helper="Permanently removes your account and every encrypted entry. Irreversible."
      >
        <template #action>
          <UButton color="error" variant="subtle" size="md" @click="deleteOpen = true">
            Delete account
          </UButton>
        </template>
      </SettingRow>
    </SettingsGroup>

    <DeleteAccountModal v-model="deleteOpen" @deleted="onDeleted" />
    <VaultExportModal v-model="exportOpen" />
    <VaultImportModal v-model="importOpen" @imported="onImported" />
  </div>
</template>
