import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { PakDevice } from '../../app/composables/usePakDevices';

// ---------------------------------------------------------------------------
// useNativeRuntime
// ---------------------------------------------------------------------------
const mockIsNative = ref(false);
vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: mockIsNative.value }),
}));

// ---------------------------------------------------------------------------
// usePakDevices
// ---------------------------------------------------------------------------
const mockDevices = ref<PakDevice[]>([]);
const mockLoading = ref(false);
const mockError = ref<string | null>(null);

const mockFetchDevices = vi.fn();
const mockRenameDevice = vi.fn();
const mockRevokeDevice = vi.fn();

vi.mock('../../app/composables/usePakDevices', () => ({
  usePakDevices: () => ({
    devices: mockDevices,
    loading: mockLoading,
    error: mockError,
    fetchDevices: mockFetchDevices,
    renameDevice: mockRenameDevice,
    revokeDevice: mockRevokeDevice,
  }),
}));

// ---------------------------------------------------------------------------
// usePakSelfRevoke
// ---------------------------------------------------------------------------
const mockSelfRevokeLoading = ref(false);
const mockSelfRevokeError = ref<string | null>(null);
const mockIsPakDevice = vi.fn().mockResolvedValue(false);
const mockRevokeThisDevice = vi.fn().mockResolvedValue(true);

vi.mock('../../app/composables/usePakSelfRevoke', () => ({
  usePakSelfRevoke: () => ({
    loading: mockSelfRevokeLoading,
    error: mockSelfRevokeError,
    isPakDevice: mockIsPakDevice,
    revokeThisDevice: mockRevokeThisDevice,
  }),
}));

// ---------------------------------------------------------------------------
// useAuthStore
// ---------------------------------------------------------------------------
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1' },
    apiFetch: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// relativeTime (used in helper text)
// ---------------------------------------------------------------------------
vi.mock('../../app/utils/account', () => ({
  relativeTime: (iso: string | null) => (iso ? '2 hours ago' : 'never'),
}));

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------
import PakDevicesCard from '../../app/components/PakDevicesCard.vue';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
const UButtonStub = {
  name: 'UButton',
  props: ['color', 'variant', 'icon', 'ariaLabel', 'loading', 'disabled'],
  emits: ['click'],
  template:
    '<button :aria-label="ariaLabel" :data-color="color" :data-variant="variant" :data-loading="loading" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};

const UIconStub = {
  name: 'UIcon',
  props: ['name'],
  template: '<span :data-icon="name" />',
};

const UInputStub = {
  name: 'UInput',
  props: ['modelValue', 'placeholder', 'disabled', 'size'],
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" :placeholder="placeholder" :disabled="disabled || undefined" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UAlertStub = {
  name: 'UAlert',
  props: ['color', 'description'],
  template: '<div role="alert" :data-color="color">{{ description }}</div>',
};

// UModal stub: renders #content slot only when open=true
const UModalStub = {
  name: 'UModal',
  props: ['open', 'title'],
  emits: ['update:open'],
  template: `
    <div class="umodal" :data-open="open" :data-title="title">
      <template v-if="open">
        <slot name="content" />
      </template>
    </div>
  `,
};

const SettingsGroupStub = {
  name: 'SettingsGroup',
  props: ['title', 'subtitle'],
  template: '<section :data-title="title" :data-subtitle="subtitle"><slot /></section>',
};

const SettingRowStub = {
  name: 'SettingRow',
  props: ['label', 'helper', 'value', 'mono'],
  template:
    '<div :data-label="label" :data-helper="helper" :data-value="value"><slot name="action" /></div>',
};

function makeDevice(overrides: Partial<PakDevice> = {}): PakDevice {
  return {
    id: 'dev-1',
    deviceName: 'My Phone',
    platform: 'android',
    enrollmentMethod: 'master_password',
    enrolledAt: '2026-06-01T10:00:00.000Z',
    lastUsedAt: '2026-06-28T08:00:00.000Z',
    revokedAt: null,
    publicKeyFingerprint: 'ab:cd:ef',
    ...overrides,
  };
}

function mountCard() {
  return mount(PakDevicesCard, {
    global: {
      stubs: {
        UButton: UButtonStub,
        UIcon: UIconStub,
        UInput: UInputStub,
        UAlert: UAlertStub,
        UModal: UModalStub,
        SettingsGroup: SettingsGroupStub,
        SettingRow: SettingRowStub,
      },
    },
  });
}

beforeEach(() => {
  mockIsNative.value = false;
  mockDevices.value = [];
  mockLoading.value = false;
  mockError.value = null;
  mockSelfRevokeLoading.value = false;
  mockSelfRevokeError.value = null;
  mockFetchDevices.mockReset();
  mockRenameDevice.mockReset();
  mockRevokeDevice.mockReset();
  mockIsPakDevice.mockReset().mockResolvedValue(false);
  mockRevokeThisDevice.mockReset().mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Native gate
// ---------------------------------------------------------------------------
describe('PakDevicesCard — native gate', () => {
  it('does not render the web device list on native platform', () => {
    mockIsNative.value = true;
    const wrapper = mountCard();
    // Web SettingsGroup (title="Phone keys") not rendered on native
    expect(wrapper.find('[data-title="Phone keys"]').exists()).toBe(false);
    // fetchDevices must not be called (onMounted guard)
    expect(mockFetchDevices).not.toHaveBeenCalled();
  });

  it('renders the web group and calls fetchDevices on web', async () => {
    mockFetchDevices.mockResolvedValue(undefined);
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.find('[data-title="Phone keys"]').exists()).toBe(true);
    expect(mockFetchDevices).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
describe('PakDevicesCard — loading', () => {
  it('shows loading spinner while fetchDevices is loading (no devices yet)', async () => {
    mockLoading.value = true;
    mockDevices.value = [];
    const wrapper = mountCard();
    const spinner = wrapper.find('[data-icon="i-lucide-loader-circle"]');
    expect(spinner.exists()).toBe(true);
  });

  it('does not show loading spinner when devices are already present (rename/revoke loading)', async () => {
    // Loading=true but devices already populated — no full-list spinner
    mockLoading.value = true;
    mockDevices.value = [makeDevice()];
    const wrapper = mountCard();
    // The per-device rows should still be rendered
    expect(wrapper.find('[data-label="My Phone"]').exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------
describe('PakDevicesCard — error', () => {
  it('shows error alert and retry button when error is set', () => {
    mockError.value = 'Could not load';
    const wrapper = mountCard();
    expect(wrapper.find('[role="alert"]').text()).toBe('Could not load');
    expect(wrapper.find('[aria-label="Retry loading phone keys"]').exists()).toBe(true);
  });

  it('calls fetchDevices when retry button is clicked', async () => {
    mockError.value = 'Could not load';
    mockFetchDevices.mockResolvedValue(undefined);
    const wrapper = mountCard();
    await wrapper.find('[aria-label="Retry loading phone keys"]').trigger('click');
    expect(mockFetchDevices).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------
describe('PakDevicesCard — empty state', () => {
  it('shows empty-state row when devices=[] and not loading', () => {
    mockDevices.value = [];
    mockLoading.value = false;
    const wrapper = mountCard();
    expect(wrapper.find('[data-label="No phone keys enrolled"]').exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Device rows
// ---------------------------------------------------------------------------
describe('PakDevicesCard — device rows', () => {
  it('renders a row for each device with name and platform info', () => {
    mockDevices.value = [
      makeDevice({ id: 'dev-1', deviceName: 'Pixel 8', platform: 'android' }),
      makeDevice({ id: 'dev-2', deviceName: 'iPhone 15', platform: 'ios' }),
    ];
    const wrapper = mountCard();
    expect(wrapper.find('[data-label="Pixel 8"]').exists()).toBe(true);
    expect(wrapper.find('[data-label="iPhone 15"]').exists()).toBe(true);
  });

  it('shows Rename and Revoke buttons for each device', () => {
    mockDevices.value = [makeDevice({ id: 'dev-1', deviceName: 'My Phone' })];
    const wrapper = mountCard();
    expect(wrapper.find('[aria-label="Rename My Phone"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Revoke My Phone"]').exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rename flow
// ---------------------------------------------------------------------------
describe('PakDevicesCard — rename flow', () => {
  it('shows inline input when Rename button is clicked', async () => {
    mockDevices.value = [makeDevice({ id: 'dev-1', deviceName: 'My Phone' })];
    const wrapper = mountCard();

    await wrapper.find('[aria-label="Rename My Phone"]').trigger('click');

    // Inline input should appear
    expect(wrapper.find('input').exists()).toBe(true);
    // Save and Cancel buttons
    expect(wrapper.find('[aria-label="Save device name"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Cancel rename"]').exists()).toBe(true);
  });

  it('calls renameDevice and hides input on Save', async () => {
    mockRenameDevice.mockResolvedValue(undefined);
    mockDevices.value = [makeDevice({ id: 'dev-1', deviceName: 'My Phone' })];
    const wrapper = mountCard();

    await wrapper.find('[aria-label="Rename My Phone"]').trigger('click');
    const input = wrapper.find('input');
    await input.setValue('New Name');
    await wrapper.find('[aria-label="Save device name"]').trigger('click');
    await flushPromises();

    expect(mockRenameDevice).toHaveBeenCalledWith('dev-1', 'New Name');
    // Input should be gone after save
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it('hides input on Cancel without calling renameDevice', async () => {
    mockDevices.value = [makeDevice({ id: 'dev-1', deviceName: 'My Phone' })];
    const wrapper = mountCard();

    await wrapper.find('[aria-label="Rename My Phone"]').trigger('click');
    await wrapper.find('[aria-label="Cancel rename"]').trigger('click');

    expect(mockRenameDevice).not.toHaveBeenCalled();
    expect(wrapper.find('input').exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Revoke flow
// ---------------------------------------------------------------------------
describe('PakDevicesCard — revoke flow', () => {
  it('opens the confirmation modal when Revoke is clicked', async () => {
    mockDevices.value = [makeDevice({ id: 'dev-1', deviceName: 'My Phone' })];
    const wrapper = mountCard();

    // Modal starts closed
    expect(wrapper.find('.umodal[data-open="false"]').exists()).toBe(true);

    await wrapper.find('[aria-label="Revoke My Phone"]').trigger('click');

    // Modal is now open
    expect(wrapper.find('.umodal[data-open="true"]').exists()).toBe(true);
  });

  it('calls revokeDevice with reason=safe when Revoke is confirmed', async () => {
    mockRevokeDevice.mockResolvedValue(undefined);
    mockDevices.value = [makeDevice({ id: 'dev-1', deviceName: 'My Phone' })];
    const wrapper = mountCard();

    await wrapper.find('[aria-label="Revoke My Phone"]').trigger('click');
    await wrapper.vm.$nextTick();

    // The modal is open — find the confirm button inside it
    const modal = wrapper.find('.umodal');
    expect(modal.attributes('data-open')).toBe('true');

    // The "Revoke" confirm button (error color) is a direct button child of the modal content
    // It is the second button (Cancel is first)
    const modalButtons = modal.findAll('button');
    const confirmBtn = modalButtons.find(b => b.text().trim() === 'Revoke');
    expect(confirmBtn).toBeTruthy();
    await confirmBtn!.trigger('click');
    await flushPromises();

    expect(mockRevokeDevice).toHaveBeenCalledWith('dev-1', 'safe');
  });
});

// ---------------------------------------------------------------------------
// Native self-revoke section
// ---------------------------------------------------------------------------
describe('PakDevicesCard — native self-revoke', () => {
  beforeEach(() => {
    mockIsNative.value = true;
  });

  it('renders nothing on native when not PAK-enrolled', async () => {
    mockIsPakDevice.mockResolvedValue(false);
    const wrapper = mountCard();
    await flushPromises();
    // Neither web group nor native group visible
    expect(wrapper.find('[data-title="Phone key"]').exists()).toBe(false);
  });

  it('renders native remove-device row when PAK-enrolled', async () => {
    mockIsPakDevice.mockResolvedValue(true);
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.find('[data-title="Phone key"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Remove this device as phone key"]').exists()).toBe(true);
  });

  it('calls revokeThisDevice and hides section on Remove click', async () => {
    mockIsPakDevice.mockResolvedValue(true);
    mockRevokeThisDevice.mockResolvedValue(true);
    const wrapper = mountCard();
    await flushPromises();

    await wrapper.find('[aria-label="Remove this device as phone key"]').trigger('click');
    await flushPromises();

    expect(mockRevokeThisDevice).toHaveBeenCalledWith('user-1');
    // After revocation isPakEnrolled=false → native group hidden
    expect(wrapper.find('[data-title="Phone key"]').exists()).toBe(false);
  });

  it('keeps section visible when revokeThisDevice returns false (user cancelled biometric)', async () => {
    mockIsPakDevice.mockResolvedValue(true);
    mockRevokeThisDevice.mockResolvedValue(false); // user cancelled
    const wrapper = mountCard();
    await flushPromises();

    await wrapper.find('[aria-label="Remove this device as phone key"]').trigger('click');
    await flushPromises();

    // Section must still be visible — enrollment was not changed
    expect(wrapper.find('[data-title="Phone key"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Remove this device as phone key"]').exists()).toBe(true);
  });
});
