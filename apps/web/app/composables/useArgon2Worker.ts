import { hexToBytes } from '@adyton/shared';

// Derives vault key in a Web Worker to avoid blocking the UI thread (~1-2s at m=65536).
// Returns a non-extractable AES-256-GCM CryptoKey — importKey runs on main thread.
export async function useArgon2Worker(
  masterPassword: string,
  kdfSaltHex: string,
): Promise<CryptoKey> {
  const salt = hexToBytes(kdfSaltHex);

  return new Promise<CryptoKey>((resolve, reject) => {
    const worker = new Worker(
      new URL('~/workers/argon2.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
      try {
        const key = await crypto.subtle.importKey(
          'raw',
          e.data,
          { name: 'AES-GCM' },
          false,                      // non-extractable
          ['encrypt', 'decrypt'],
        );
        resolve(key);
      } catch (err) {
        reject(err);
      } finally {
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    worker.postMessage({ password: masterPassword, salt });
  });
}
