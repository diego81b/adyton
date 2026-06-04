<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import {
  VaultEntryType,
  generatePassword,
  type EnvironmentTag,
  type DecryptedEntry,
  type PasswordOptions,
} from '@adyton/shared';
import type { EntryDraft } from '../utils/vault-crypto';
import { TYPE_META, TILE_CLASS, TYPE_FILTERS, ENVIRONMENT_META } from '../utils/entry-display';
import PasswordInput from './PasswordInput.vue';

// Unified add/edit modal for all 6 entry types. Presentational only: it builds an
// EntryDraft and emits it; the parent page performs the store create/update (so the
// modal is unit-testable without Pinia/crypto). The form is type-scoped — only the
// selected type's fields are emitted (a flat form would leak stale fields of other
// types into the encrypted blob; see FIELDS_BY_TYPE + buildDraft).

const open = defineModel<boolean>({ required: true });
// True while the form differs from its initialized state. Parents feed this to
// useLockDeferral so an absolute-mode auto-lock won't destroy unsaved edits.
const dirty = defineModel<boolean>('dirty', { default: false });
const props = withDefaults(
  defineProps<{
    /** When present → EDIT mode: prefill + lock the type selector. */
    entry?: DecryptedEntry | null;
  }>(),
  { entry: null },
);
const emit = defineEmits<{ save: [draft: EntryDraft] }>();

const isEdit = computed(() => props.entry != null);

// --- Form state ------------------------------------------------------------
// One flat reactive bag for binding convenience. Emission is scoped per type via
// FIELDS_BY_TYPE so cross-type fields never reach the draft.
interface FormState {
  label: string;
  url: string;
  username: string;
  password: string;
  totpSecret: string;
  notes: string;
  environment: EnvironmentTag;
  envContent: string;
  secretKey: string;
  secretValue: string;
  secretDescription: string;
  cardholderName: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

function emptyForm(): FormState {
  return {
    label: '',
    url: '',
    username: '',
    password: '',
    totpSecret: '',
    notes: '',
    environment: 'production',
    envContent: '',
    secretKey: '',
    secretValue: '',
    secretDescription: '',
    cardholderName: '',
    cardNumber: '',
    cardExpiry: '',
    cardCvv: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  };
}

const form = reactive<FormState>(emptyForm());
const selectedType = ref<VaultEntryType>(VaultEntryType.LOGIN);

// Per-type field whitelist. Also the render guard: a field shows iff it is in this
// list for the active type. `label` is implicit (always rendered, always emitted).
// `environment` is structural metadata (not in the blob) — handled separately.
const FIELDS_BY_TYPE: Record<VaultEntryType, (keyof EntryDraft)[]> = {
  [VaultEntryType.LOGIN]: ['url', 'username', 'password', 'totpSecret', 'notes'],
  [VaultEntryType.ENV_FILE]: ['envContent', 'notes'],
  [VaultEntryType.SECRET]: ['secretKey', 'secretValue', 'secretDescription'],
  [VaultEntryType.SECURE_NOTE]: ['notes'],
  [VaultEntryType.CREDIT_CARD]: ['cardholderName', 'cardNumber', 'cardExpiry', 'cardCvv', 'notes'],
  [VaultEntryType.IDENTITY]: ['firstName', 'lastName', 'email', 'phone', 'notes'],
};

// Types whose draft carries an environment tag.
const ENV_TYPES = new Set<VaultEntryType>([VaultEntryType.ENV_FILE, VaultEntryType.SECRET]);

const meta = computed(() => TYPE_META[selectedType.value]);
const tileClass = computed(() => TILE_CLASS[meta.value.color]);
const hasEnvironment = computed(() => ENV_TYPES.has(selectedType.value));

// Slideover instead of a centered modal: it never re-centers/resizes when the entry
// type (and thus field count) changes. Desktop → from the right (full height); mobile
// (< lg) → from the bottom (a bottom sheet, the standard mobile form pattern).
const isDesktop = useMediaQuery('(min-width: 1024px)');
const slideSide = computed<'right' | 'bottom'>(() => (isDesktop.value ? 'right' : 'bottom'));

const labelValid = computed(() => form.label.trim().length > 0);
const saveDisabled = computed(() => !labelValid.value);

const environmentItems = (Object.keys(ENVIRONMENT_META) as EnvironmentTag[]).map((value) => ({
  value,
  label: ENVIRONMENT_META[value].label,
}));

const generatorOptions: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

function generate() {
  form.password = generatePassword(generatorOptions);
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // Read client-side only — the file is never uploaded.
  form.envContent = await file.text();
  input.value = '';
}

// --- Prefill / reset -------------------------------------------------------
// Baseline snapshot for dirty tracking — set whenever the form (re)initializes.
let baseline = '';
function snapshot(): string {
  return JSON.stringify({ ...form, _type: selectedType.value });
}

function initForm() {
  Object.assign(form, emptyForm());
  const e = props.entry;
  if (e) {
    selectedType.value = e.type;
    form.label = e.label ?? '';
    form.url = e.url ?? '';
    form.username = e.username ?? '';
    form.password = e.password ?? '';
    form.totpSecret = e.totpSecret ?? '';
    form.notes = e.notes ?? '';
    if (e.environment) form.environment = e.environment;
    form.envContent = e.envContent ?? '';
    form.secretKey = e.secretKey ?? '';
    form.secretValue = e.secretValue ?? '';
    form.secretDescription = e.secretDescription ?? '';
    form.cardholderName = e.cardholderName ?? '';
    form.cardNumber = e.cardNumber ?? '';
    form.cardExpiry = e.cardExpiry ?? '';
    form.cardCvv = e.cardCvv ?? '';
    form.firstName = e.firstName ?? '';
    form.lastName = e.lastName ?? '';
    form.email = e.email ?? '';
    form.phone = e.phone ?? '';
  } else {
    selectedType.value = VaultEntryType.LOGIN;
  }
  baseline = snapshot();
}

// Initialize immediately (covers mounting already-open) and on every subsequent
// open (false → true) or entry change while open. `immediate` runs in setup so the
// first render already reflects EDIT-mode prefill / locked type.
watch(
  () => [open.value, props.entry] as const,
  ([isOpen], prev) => {
    const wasOpen = prev?.[0];
    if (isOpen && !wasOpen) initForm();
  },
  { immediate: true },
);

// Dirty = open with edits. Closing (save or cancel) always clears it.
watch(
  () => [open.value, snapshot()] as const,
  ([isOpen, current]) => {
    dirty.value = isOpen && current !== baseline;
  },
  { immediate: true },
);

// --- Save ------------------------------------------------------------------
function buildDraft(): EntryDraft {
  const draft = {
    type: selectedType.value,
    label: form.label.trim(),
  } as EntryDraft;

  for (const field of FIELDS_BY_TYPE[selectedType.value]) {
    const value = form[field as keyof FormState];
    if (typeof value === 'string' && value.trim() !== '') {
      (draft as Record<string, unknown>)[field] = value;
    }
  }

  if (hasEnvironment.value) draft.environment = form.environment;

  return draft;
}

function save() {
  if (saveDisabled.value) return;
  emit('save', buildDraft());
  open.value = false;
}

function close() {
  open.value = false;
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="slideSide"
    :title="isEdit ? 'Edit Entry' : `New ${meta.label} Entry`"
    :ui="{ content: 'w-full max-w-none lg:max-w-xl' }"
  >
    <template #content>
      <!-- Mobile (bottom sheet): FIXED tall height (≈92dvh) so it opens up to near the
           top edge with a small margin, stays top-aligned, and never resizes when the
           entry type changes — more room for the fields. Desktop (right panel): fill the
           full-height panel. Body scrolls in both. -->
      <div class="flex flex-col h-[92dvh] lg:h-full">
        <!-- Header -->
        <div
          class="sticky top-0 z-10 bg-default px-5 py-4 border-b border-default flex items-center justify-between"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="size-8 rounded-lg flex items-center justify-center border shrink-0" :class="tileClass">
              <UIcon :name="meta.icon" class="size-4" />
            </div>
            <h2 class="font-bold tracking-tight truncate">
              {{ isEdit ? `Edit ${meta.label} Entry` : `New ${meta.label} Entry` }}
            </h2>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-x"
            aria-label="Close"
            @click="close"
          />
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto">
          <!-- Type selector — equal-size grid, no horizontal scroll. -->
          <div class="px-5 pt-4">
            <div class="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Entry Type</div>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="t in TYPE_FILTERS"
                :key="t.type"
                type="button"
                :disabled="isEdit"
                :aria-pressed="selectedType === t.type"
                class="flex items-center justify-center px-2 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-60 disabled:cursor-not-allowed"
                :class="
                  selectedType === t.type
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'text-muted border-default hover:bg-elevated hover:text-highlighted'
                "
                @click="!isEdit && (selectedType = t.type)"
              >
                {{ t.label }}
              </button>
            </div>
          </div>

          <!-- Form -->
          <UForm :state="form" class="px-5 py-4 space-y-3.5" @submit.prevent="save">
            <UFormField label="Label" name="label" required>
              <UInput v-model="form.label" size="lg" class="w-full" placeholder="e.g. GitHub" />
            </UFormField>

            <!-- LOGIN -->
            <template v-if="selectedType === VaultEntryType.LOGIN">
              <UFormField label="URL" name="url">
                <UInput v-model="form.url" size="lg" class="w-full font-mono" placeholder="https://github.com" />
              </UFormField>
              <UFormField label="Username" name="username">
                <UInput v-model="form.username" size="lg" class="w-full" placeholder="alice@example.com" />
              </UFormField>
              <UFormField label="Password" name="password">
                <div class="flex gap-2">
                  <PasswordInput
                    v-model="form.password"
                    class="flex-1"
                    placeholder="••••••••••••"
                    autocomplete="new-password"
                  />
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="lg"
                    icon="i-lucide-refresh-cw"
                    class="shrink-0"
                    aria-label="Generate password"
                    @click="generate"
                  >
                    <span class="hidden sm:inline">Generate</span>
                  </UButton>
                </div>
              </UFormField>
              <UFormField name="totpSecret">
                <template #label>
                  TOTP Secret <span class="text-dimmed font-normal">— optional</span>
                </template>
                <template #help>Base32 seed</template>
                <UInput
                  v-model="form.totpSecret"
                  size="lg"
                  class="w-full font-mono"
                  placeholder="JBSWY3DPEHPK3PXP"
                />
              </UFormField>
              <UFormField label="Notes" name="notes">
                <UTextarea
                  v-model="form.notes"
                  :rows="3"
                  size="lg"
                  class="w-full"
                  placeholder="Recovery codes, 2FA backup details, anything else…"
                />
              </UFormField>
            </template>

            <!-- ENV_FILE -->
            <template v-else-if="selectedType === VaultEntryType.ENV_FILE">
              <UFormField label="Environment" name="environment">
                <USelect v-model="form.environment" :items="environmentItems" size="lg" class="w-full" />
              </UFormField>
              <UFormField label="Env File" name="envContent">
                <UTextarea
                  v-model="form.envContent"
                  :rows="8"
                  size="lg"
                  class="w-full font-mono"
                  placeholder="DATABASE_URL=postgres://…&#10;API_KEY=…"
                />
              </UFormField>
              <UFormField name="envFile">
                <template #label>Upload .env <span class="text-dimmed font-normal">— optional</span></template>
                <template #help>Read locally, never uploaded</template>
                <input
                  type="file"
                  accept=".env,.txt,.json"
                  class="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-default file:bg-elevated file:text-highlighted file:text-xs file:font-semibold"
                  @change="onFilePicked"
                />
              </UFormField>
              <UFormField label="Notes" name="notes">
                <UTextarea v-model="form.notes" :rows="2" size="lg" class="w-full" />
              </UFormField>
            </template>

            <!-- SECRET -->
            <template v-else-if="selectedType === VaultEntryType.SECRET">
              <UFormField label="Environment" name="environment">
                <USelect v-model="form.environment" :items="environmentItems" size="lg" class="w-full" />
              </UFormField>
              <UFormField label="Key" name="secretKey">
                <UInput v-model="form.secretKey" size="lg" class="w-full font-mono" placeholder="STRIPE_API_KEY" />
              </UFormField>
              <UFormField label="Value" name="secretValue">
                <PasswordInput
                  v-model="form.secretValue"
                  class="w-full"
                  placeholder="sk_live_…"
                  autocomplete="off"
                />
              </UFormField>
              <UFormField name="secretDescription">
                <template #label>Description <span class="text-dimmed font-normal">— optional</span></template>
                <UInput v-model="form.secretDescription" size="lg" class="w-full" placeholder="What is this for?" />
              </UFormField>
            </template>

            <!-- SECURE_NOTE -->
            <template v-else-if="selectedType === VaultEntryType.SECURE_NOTE">
              <UFormField label="Note" name="notes">
                <UTextarea
                  v-model="form.notes"
                  :rows="8"
                  size="lg"
                  class="w-full"
                  placeholder="Write anything you want to keep safe…"
                />
              </UFormField>
            </template>

            <!-- CREDIT_CARD -->
            <template v-else-if="selectedType === VaultEntryType.CREDIT_CARD">
              <UFormField label="Cardholder Name" name="cardholderName">
                <UInput v-model="form.cardholderName" size="lg" class="w-full" placeholder="Alice Smith" />
              </UFormField>
              <UFormField label="Card Number" name="cardNumber">
                <UInput
                  v-model="form.cardNumber"
                  size="lg"
                  class="w-full font-mono"
                  placeholder="4242 4242 4242 4242"
                />
              </UFormField>
              <div class="grid grid-cols-2 gap-3">
                <UFormField label="Expiry" name="cardExpiry">
                  <UInput v-model="form.cardExpiry" size="lg" class="w-full font-mono" placeholder="MM/YY" />
                </UFormField>
                <UFormField label="CVV" name="cardCvv">
                  <PasswordInput v-model="form.cardCvv" class="w-full" placeholder="•••" autocomplete="off" />
                </UFormField>
              </div>
              <UFormField label="Notes" name="notes">
                <UTextarea v-model="form.notes" :rows="2" size="lg" class="w-full" />
              </UFormField>
            </template>

            <!-- IDENTITY -->
            <template v-else-if="selectedType === VaultEntryType.IDENTITY">
              <div class="grid grid-cols-2 gap-3">
                <UFormField label="First Name" name="firstName">
                  <UInput v-model="form.firstName" size="lg" class="w-full" placeholder="Alice" />
                </UFormField>
                <UFormField label="Last Name" name="lastName">
                  <UInput v-model="form.lastName" size="lg" class="w-full" placeholder="Smith" />
                </UFormField>
              </div>
              <UFormField label="Email" name="email">
                <UInput v-model="form.email" type="email" size="lg" class="w-full" placeholder="alice@example.com" />
              </UFormField>
              <UFormField label="Phone" name="phone">
                <UInput v-model="form.phone" size="lg" class="w-full font-mono" placeholder="+1 555 123 4567" />
              </UFormField>
              <UFormField label="Notes" name="notes">
                <UTextarea v-model="form.notes" :rows="2" size="lg" class="w-full" />
              </UFormField>
            </template>
          </UForm>
        </div>

        <!-- Footer -->
        <div
          class="sticky bottom-0 z-10 bg-default px-5 py-4 border-t border-default flex gap-2"
        >
          <UButton color="neutral" variant="soft" size="lg" class="flex-1 justify-center" @click="close">
            Cancel
          </UButton>
          <UButton
            color="primary"
            size="lg"
            class="flex-1 justify-center"
            :disabled="saveDisabled"
            :title="saveDisabled ? 'A label is required' : undefined"
            @click="save"
          >
            {{ isEdit ? 'Save Changes' : 'Save Entry' }}
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>
</template>
