import { ref, readonly } from 'vue';
import { useAuthStore } from '~/stores/auth';

// Mirrors apps/api/src/pak/dto/pak-response.dto.ts — dates arrive as ISO strings over
// the wire even though the server DTO types them as Date.
export interface PakDevice {
  id: string;
  deviceName: string;
  platform: string;           // 'android' | 'ios'
  enrollmentMethod: string;   // 'master_password' | 'existing_device' | 'recovery_kit'
  enrolledAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  publicKeyFingerprint: string;
}

export function usePakDevices() {
  const devices = ref<PakDevice[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchDevices(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const auth = useAuthStore();
      const result = await auth.apiFetch<PakDevice[]>('/pak/devices');
      devices.value = result;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to load devices.';
    } finally {
      loading.value = false;
    }
  }

  async function renameDevice(id: string, name: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const auth = useAuthStore();
      const updated = await auth.apiFetch<PakDevice>(`/pak/devices/${id}`, {
        method: 'PATCH',
        body: { deviceName: name },
      });
      const idx = devices.value.findIndex(d => d.id === id);
      if (idx !== -1) {
        devices.value[idx] = updated;
      }
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to rename device.';
    } finally {
      loading.value = false;
    }
  }

  async function revokeDevice(id: string, reason: 'safe' | 'compromised'): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const auth = useAuthStore();
      await auth.apiFetch<void>(`/pak/devices/${id}?reason=${reason}`, { method: 'DELETE' });
      devices.value = devices.value.filter(d => d.id !== id);
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to revoke device.';
    } finally {
      loading.value = false;
    }
  }

  return {
    devices: readonly(devices),
    loading: readonly(loading),
    error: readonly(error),
    fetchDevices,
    renameDevice,
    revokeDevice,
  };
}
