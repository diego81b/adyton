import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

// ---------------------------------------------------------------------------
// QRCode — canvas rendering is a side effect; stub it out
// ---------------------------------------------------------------------------
vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}));

// ---------------------------------------------------------------------------
// useNativeRuntime
// ---------------------------------------------------------------------------
const mockIsNative = ref(false);
vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: mockIsNative.value }),
}));

// ---------------------------------------------------------------------------
// usePakEnrollment — full state machine stub
// ---------------------------------------------------------------------------
type EnrollPhase =
  | 'idle'
  | 'starting'
  | 'qr-shown'
  | 'phone-connected'
  | 'confirming'
  | 'sending'
  | 'recovery-kit-pending'
  | 'finalizing'
  | 'enrolled'
  | 'error';

const mockPhase = ref<EnrollPhase>('idle');
const mockQrUrl = ref<string | null>(null);
const mockError = ref<string | null>(null);
const mockConnectedDeviceId = ref<string | null>(null);
const mockPendingMnemonic = ref<string[] | null>(null);

const mockStart = vi.fn();
const mockConfirmAndSend = vi.fn();
const mockFinalizeEnrollment = vi.fn();
const mockCancel = vi.fn();
const mockReset = vi.fn();

vi.mock('../../app/composables/usePakEnrollment', () => ({
  usePakEnrollment: () => ({
    phase: mockPhase,
    qrUrl: mockQrUrl,
    error: mockError,
    connectedDeviceId: mockConnectedDeviceId,
    pendingMnemonic: mockPendingMnemonic,
    start: mockStart,
    confirmAndSend: mockConfirmAndSend,
    finalizeEnrollment: mockFinalizeEnrollment,
    cancel: mockCancel,
    reset: mockReset,
  }),
}));

import PakEnrollCard from '../../app/components/PakEnrollCard.vue';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
const UButtonStub = {
  name: 'UButton',
  props: ['color', 'variant', 'icon', 'ariaLabel', 'loading', 'disabled'],
  emits: ['click'],
  template:
    '<button :aria-label="ariaLabel" :data-loading="loading" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};

const UIconStub = {
  name: 'UIcon',
  props: ['name'],
  template: '<span :data-icon="name" />',
};

const UInputStub = {
  name: 'UInput',
  props: ['modelValue', 'type', 'disabled', 'placeholder'],
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" :type="type" :disabled="disabled || undefined" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UAlertStub = {
  name: 'UAlert',
  props: ['color', 'description'],
  template: '<div role="alert" :data-color="color">{{ description }}</div>',
};

const UFormFieldStub = {
  name: 'UFormField',
  props: ['label'],
  template: '<div><slot /></div>',
};

const SettingRowStub = {
  name: 'SettingRow',
  props: ['label', 'helper', 'dot'],
  template: '<div :data-label="label" :data-helper="helper" :data-dot="dot"><slot name="action" /></div>',
};

const RecoveryKitSetupStepStub = {
  name: 'RecoveryKitSetupStep',
  props: ['mnemonic', 'loading'],
  emits: ['confirm'],
  template: '<div data-testid="recovery-kit-step" :data-loading="loading" @click="$emit(\'confirm\')" />',
};

function mountCard() {
  return mount(PakEnrollCard, {
    global: {
      stubs: {
        UButton: UButtonStub,
        UIcon: UIconStub,
        UInput: UInputStub,
        UAlert: UAlertStub,
        UFormField: UFormFieldStub,
        SettingRow: SettingRowStub,
        RecoveryKitSetupStep: RecoveryKitSetupStepStub,
      },
    },
  });
}

beforeEach(() => {
  mockIsNative.value = false;
  mockPhase.value = 'idle';
  mockQrUrl.value = null;
  mockError.value = null;
  mockConnectedDeviceId.value = null;
  mockPendingMnemonic.value = null;
  mockStart.mockReset();
  mockConfirmAndSend.mockReset();
  mockFinalizeEnrollment.mockReset();
  mockCancel.mockReset();
  mockReset.mockReset();
});

// ---------------------------------------------------------------------------
// Native gate
// ---------------------------------------------------------------------------
describe('PakEnrollCard — native gate', () => {
  it('renders nothing on native platform', () => {
    mockIsNative.value = true;
    const wrapper = mountCard();
    // On native the outer <template v-if="!isNative"> hides the content;
    // find() for any known element should be empty.
    expect(wrapper.find('[aria-label="Start phone enrollment"]').exists()).toBe(false);
    expect(wrapper.find('[data-label]').exists()).toBe(false);
  });

  it('renders content on web platform', () => {
    const wrapper = mountCard();
    expect(wrapper.find('[data-label="Phone as Key"]').exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// idle
// ---------------------------------------------------------------------------
describe('PakEnrollCard — idle', () => {
  it('shows the "Enroll phone" button and calls start() on click', async () => {
    const wrapper = mountCard();
    const btn = wrapper.find('[aria-label="Start phone enrollment"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(mockStart).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// starting
// ---------------------------------------------------------------------------
describe('PakEnrollCard — starting', () => {
  it('shows a loading spinner', () => {
    mockPhase.value = 'starting';
    const wrapper = mountCard();
    expect(wrapper.find('[aria-label="Loading"]').exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// qr-shown
// ---------------------------------------------------------------------------
describe('PakEnrollCard — qr-shown', () => {
  beforeEach(() => {
    mockPhase.value = 'qr-shown';
    mockQrUrl.value = 'adyton://pak?d=abc';
  });

  it('shows a canvas for the QR code', () => {
    const wrapper = mountCard();
    expect(wrapper.find('canvas').exists()).toBe(true);
  });

  it('shows the cancel button and calls cancel() on click', async () => {
    const wrapper = mountCard();
    const btn = wrapper.find('[aria-label="Cancel enrollment"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(mockCancel).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// phone-connected
// ---------------------------------------------------------------------------
describe('PakEnrollCard — phone-connected', () => {
  beforeEach(() => {
    mockPhase.value = 'phone-connected';
    mockConnectedDeviceId.value = 'dev-42';
  });

  it('shows a password input and confirm button', () => {
    const wrapper = mountCard();
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
  });

  it('calls confirmAndSend with the typed password on confirm click', async () => {
    mockConfirmAndSend.mockResolvedValue(undefined);
    const wrapper = mountCard();
    const input = wrapper.find('input[type="password"]');
    await input.setValue('my-password');
    // Find the "Confirm & send" button — it has no aria-label so we find by text
    const buttons = wrapper.findAll('button');
    const confirmBtn = buttons.find(b => b.text().includes('Confirm'));
    expect(confirmBtn).toBeTruthy();
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(mockConfirmAndSend).toHaveBeenCalledWith('my-password');
  });

  it('calls cancel() when the cancel button is clicked', async () => {
    const wrapper = mountCard();
    // find by text
    const buttons = wrapper.findAll('button');
    const cancelButton = buttons.find(b => b.text().includes('Cancel'));
    expect(cancelButton).toBeTruthy();
    await cancelButton!.trigger('click');
    expect(mockCancel).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// recovery-kit-pending
// ---------------------------------------------------------------------------
describe('PakEnrollCard — recovery-kit-pending', () => {
  beforeEach(() => {
    mockPhase.value = 'recovery-kit-pending';
    mockPendingMnemonic.value = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
  });

  it('shows the warning dot and recovery-kit header', () => {
    const wrapper = mountCard();
    expect(wrapper.find('[data-dot="bg-warning"]').exists()).toBe(true);
  });

  it('renders RecoveryKitSetupStep when pendingMnemonic is set', () => {
    const wrapper = mountCard();
    expect(wrapper.find('[data-testid="recovery-kit-step"]').exists()).toBe(true);
  });

  it('calls finalizeEnrollment when RecoveryKitSetupStep emits confirm', async () => {
    mockFinalizeEnrollment.mockResolvedValue(undefined);
    const wrapper = mountCard();
    await wrapper.find('[data-testid="recovery-kit-step"]').trigger('click');
    expect(mockFinalizeEnrollment).toHaveBeenCalledOnce();
  });

  it('passes loading=false when phase is recovery-kit-pending', () => {
    const wrapper = mountCard();
    const step = wrapper.find('[data-testid="recovery-kit-step"]');
    expect(step.attributes('data-loading')).toBe('false');
  });
});

describe('PakEnrollCard — finalizing', () => {
  it('passes loading=true to RecoveryKitSetupStep when phase is finalizing', () => {
    mockPhase.value = 'finalizing';
    mockPendingMnemonic.value = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
    const wrapper = mountCard();
    const step = wrapper.find('[data-testid="recovery-kit-step"]');
    expect(step.attributes('data-loading')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// enrolled
// ---------------------------------------------------------------------------
describe('PakEnrollCard — enrolled', () => {
  it('shows success state and "Enroll another" button that calls reset()', async () => {
    mockPhase.value = 'enrolled';
    const wrapper = mountCard();
    expect(wrapper.find('[data-dot="bg-success"]').exists()).toBe(true);
    const btn = wrapper.find('[aria-label="Enroll another phone"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(mockReset).toHaveBeenCalledOnce();
  });

  // Regression: settings/index.vue's PakDevicesCard only refetches on mount, so
  // finishing enrollment left "No phone keys enrolled" showing until a manual page
  // reload. PakEnrollCard must emit 'enrolled' the moment phase flips so the page
  // can trigger PakDevicesCard's refresh.
  it('emits "enrolled" when phase transitions to enrolled', async () => {
    mockPhase.value = 'finalizing';
    const wrapper = mountCard();
    expect(wrapper.emitted('enrolled')).toBeUndefined();

    mockPhase.value = 'enrolled';
    await flushPromises();
    expect(wrapper.emitted('enrolled')).toHaveLength(1);
  });

  it('does not emit "enrolled" when mounted directly into the enrolled phase', () => {
    mockPhase.value = 'enrolled';
    const wrapper = mountCard();
    expect(wrapper.emitted('enrolled')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------
describe('PakEnrollCard — error', () => {
  it('shows the error message and a "Try again" button that calls reset()', async () => {
    mockPhase.value = 'error';
    mockError.value = 'Something went wrong';
    const wrapper = mountCard();

    expect(wrapper.find('[role="alert"]').text()).toBe('Something went wrong');
    const btn = wrapper.find('[aria-label="Reset enrollment"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(mockReset).toHaveBeenCalledOnce();
  });

  it('does not render the alert when error is null', () => {
    mockPhase.value = 'error';
    mockError.value = null;
    const wrapper = mountCard();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
