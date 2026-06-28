import { hexToBytes } from '@adyton/shared';

// ---------------------------------------------------------------------------
// deriveRawKey
// ---------------------------------------------------------------------------
// Sends the Argon2id derivation into a Web Worker to avoid blocking the UI
// thread (~1-2 s at m=65536). Returns the raw 32-byte output as ArrayBuffer.
// The caller is responsible for importing it as a CryptoKey (importVaultKey).
export async function deriveRawKey(
  masterPassword: string,
  kdfSaltHex: string,
): Promise<ArrayBuffer> {
  const salt = hexToBytes(kdfSaltHex);

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = new Worker(
      new URL('~/workers/argon2.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      worker.terminate();
      resolve(e.data);
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    worker.postMessage({ password: masterPassword, salt });
  });
}

// ---------------------------------------------------------------------------
// importVaultKey
// ---------------------------------------------------------------------------
// Imports raw 32-byte key material as a non-extractable AES-256-GCM CryptoKey.
// The `false` extractable flag is enforced by the Web Crypto API — the key
// bytes can never be read back out of the browser key store after this call.
export async function importVaultKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,                      // non-extractable — security invariant
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// useArgon2Worker  (public signature unchanged)
// ---------------------------------------------------------------------------
// Convenience composition: derive raw bytes in a Worker, then import as key.
// All existing callers (crypto store deriveKey) continue to work unchanged.
export async function useArgon2Worker(
  masterPassword: string,
  kdfSaltHex: string,
): Promise<CryptoKey> {
  const raw = await deriveRawKey(masterPassword, kdfSaltHex);
  return importVaultKey(raw);
}
