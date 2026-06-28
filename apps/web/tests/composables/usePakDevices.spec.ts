import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---------------------------------------------------------------------------
// Auth store — mock apiFetch
// ---------------------------------------------------------------------------
const mockApiFetch = vi.fn();

vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Import under test — after all vi.mock declarations
// ---------------------------------------------------------------------------
import { usePakDevices, type PakDevice } from '../../app/composables/usePakDevices';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
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

beforeEach(() => {
  setActivePinia(createPinia());
  mockApiFetch.mockReset();
});

// ---------------------------------------------------------------------------
// fetchDevices
// ---------------------------------------------------------------------------
describe('usePakDevices.fetchDevices', () => {
  it('sets devices from API response', async () => {
    const list = [makeDevice({ id: 'dev-1' }), makeDevice({ id: 'dev-2', deviceName: 'Tablet' })];
    mockApiFetch.mockResolvedValueOnce(list);

    const { devices, loading, error, fetchDevices } = usePakDevices();

    const promise = fetchDevices();
    // loading is true while pending
    expect(loading.value).toBe(true);
    await promise;

    expect(devices.value).toEqual(list);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
    expect(mockApiFetch).toHaveBeenCalledWith('/devices');
  });

  it('sets error on failure and clears loading', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('network timeout'));

    const { devices, loading, error, fetchDevices } = usePakDevices();
    await fetchDevices();

    expect(devices.value).toEqual([]);
    expect(loading.value).toBe(false);
    expect(error.value).toBe('network timeout');
  });

  it('sets a generic error message for non-Error rejections', async () => {
    mockApiFetch.mockRejectedValueOnce('oops');

    const { error, fetchDevices } = usePakDevices();
    await fetchDevices();

    expect(error.value).toBe('Failed to load devices.');
  });
});

// ---------------------------------------------------------------------------
// renameDevice
// ---------------------------------------------------------------------------
describe('usePakDevices.renameDevice', () => {
  it('PATCHes /devices/:id and updates the device in the list in-place', async () => {
    const original = makeDevice({ id: 'dev-1', deviceName: 'Old Name' });
    const updated = { ...original, deviceName: 'New Name' };

    mockApiFetch
      .mockResolvedValueOnce([original])   // fetchDevices
      .mockResolvedValueOnce(updated);     // renameDevice

    const { devices, fetchDevices, renameDevice } = usePakDevices();
    await fetchDevices();
    expect(devices.value[0].deviceName).toBe('Old Name');

    await renameDevice('dev-1', 'New Name');

    expect(mockApiFetch).toHaveBeenCalledWith('/devices/dev-1', {
      method: 'PATCH',
      body: { deviceName: 'New Name' },
    });
    expect(devices.value[0].deviceName).toBe('New Name');
    // Other fields preserved
    expect(devices.value[0].id).toBe('dev-1');
  });

  it('sets error and does not modify the list on PATCH failure', async () => {
    const original = makeDevice({ id: 'dev-1' });
    mockApiFetch
      .mockResolvedValueOnce([original])
      .mockRejectedValueOnce(new Error('server error'));

    const { devices, error, fetchDevices, renameDevice } = usePakDevices();
    await fetchDevices();
    await renameDevice('dev-1', 'Anything');

    expect(error.value).toBe('server error');
    // Device unchanged in list
    expect(devices.value[0].deviceName).toBe('My Phone');
  });
});

// ---------------------------------------------------------------------------
// revokeDevice
// ---------------------------------------------------------------------------
describe('usePakDevices.revokeDevice', () => {
  it('DELETEs and removes the device from the list', async () => {
    const device = makeDevice({ id: 'dev-1' });
    mockApiFetch
      .mockResolvedValueOnce([device])   // fetchDevices
      .mockResolvedValueOnce(undefined); // DELETE → 204

    const { devices, fetchDevices, revokeDevice } = usePakDevices();
    await fetchDevices();
    expect(devices.value).toHaveLength(1);

    await revokeDevice('dev-1', 'safe');

    expect(devices.value).toHaveLength(0);
    expect(mockApiFetch).toHaveBeenCalledWith('/devices/dev-1?reason=safe', { method: 'DELETE' });
  });

  it('passes reason=compromised in the query string', async () => {
    const device = makeDevice({ id: 'dev-2' });
    mockApiFetch
      .mockResolvedValueOnce([device])
      .mockResolvedValueOnce(undefined);

    const { fetchDevices, revokeDevice } = usePakDevices();
    await fetchDevices();
    await revokeDevice('dev-2', 'compromised');

    expect(mockApiFetch).toHaveBeenCalledWith('/devices/dev-2?reason=compromised', { method: 'DELETE' });
  });

  it('sets error on DELETE failure and keeps device in list', async () => {
    const device = makeDevice({ id: 'dev-1' });
    mockApiFetch
      .mockResolvedValueOnce([device])
      .mockRejectedValueOnce(new Error('forbidden'));

    const { devices, error, fetchDevices, revokeDevice } = usePakDevices();
    await fetchDevices();
    await revokeDevice('dev-1', 'safe');

    expect(error.value).toBe('forbidden');
    // Device still in list
    expect(devices.value).toHaveLength(1);
  });

  it('clears loading in finally even on error', async () => {
    const device = makeDevice({ id: 'dev-1' });
    mockApiFetch
      .mockResolvedValueOnce([device])
      .mockRejectedValueOnce(new Error('timeout'));

    const { loading, fetchDevices, revokeDevice } = usePakDevices();
    await fetchDevices();

    const promise = revokeDevice('dev-1', 'safe');
    expect(loading.value).toBe(true);
    await promise;
    expect(loading.value).toBe(false);
  });
});
