import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the Web Worker constructor.
// useArgon2Worker.ts constructs `new Worker(new URL(...), { type: 'module' })`.
// We replace the global Worker with a plain class (not wrapped in vi.fn()) so
// `new Worker(...)` works. Constructor call tracking uses a separate counter.
// ---------------------------------------------------------------------------
let workerOnMessage: ((e: MessageEvent<ArrayBuffer>) => void) | null = null;
let workerOnError: ((e: ErrorEvent) => void) | null = null;
let postedMessage: unknown = null;
let terminateCalled = false;
let constructorCallCount = 0;

class MockWorker {
  constructor(_url: unknown, _opts?: unknown) {
    constructorCallCount += 1;
  }
  set onmessage(fn: (e: MessageEvent<ArrayBuffer>) => void) {
    workerOnMessage = fn;
  }
  set onerror(fn: (e: ErrorEvent) => void) {
    workerOnError = fn;
  }
  postMessage(msg: unknown) {
    postedMessage = msg;
  }
  terminate() {
    terminateCalled = true;
  }
}

// Stub the global Worker with our class. Must happen before the composable import.
vi.stubGlobal('Worker', MockWorker);

import { deriveRawKey, importVaultKey, useArgon2Worker } from '../../app/composables/useArgon2Worker';

// A deterministic 32-byte ArrayBuffer used as fake Argon2id output.
function fakeRawKey(): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).fill(0xab);
  return buf;
}

beforeEach(() => {
  workerOnMessage = null;
  workerOnError = null;
  postedMessage = null;
  terminateCalled = false;
  constructorCallCount = 0;
});

// ---------------------------------------------------------------------------
// deriveRawKey
// ---------------------------------------------------------------------------
describe('deriveRawKey', () => {
  it('creates a Worker and posts { password, salt }', async () => {
    const saltHex = 'a'.repeat(64); // 32 bytes in hex
    const promise = deriveRawKey('master', saltHex);

    // Simulate worker posting raw bytes back to main thread
    const raw = fakeRawKey();
    workerOnMessage!({ data: raw } as MessageEvent<ArrayBuffer>);

    await promise;
    expect(constructorCallCount).toBe(1);
    expect(postedMessage).toEqual({
      password: 'master',
      salt: expect.any(Uint8Array),
    });
  });

  it('returns the raw ArrayBuffer from the worker unchanged', async () => {
    const promise = deriveRawKey('pw', 'ff'.repeat(32));
    const raw = fakeRawKey();
    workerOnMessage!({ data: raw } as MessageEvent<ArrayBuffer>);
    const result = await promise;
    expect(result).toBe(raw);
  });

  it('terminates the worker after a successful response', async () => {
    const promise = deriveRawKey('pw', '00'.repeat(32));
    workerOnMessage!({ data: fakeRawKey() } as MessageEvent<ArrayBuffer>);
    await promise;
    expect(terminateCalled).toBe(true);
  });

  it('rejects and terminates the worker on error', async () => {
    const promise = deriveRawKey('pw', '00'.repeat(32));
    workerOnError!(new ErrorEvent('error', { message: 'worker crashed' }));
    await expect(promise).rejects.toBeDefined();
    expect(terminateCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// importVaultKey
// ---------------------------------------------------------------------------
describe('importVaultKey', () => {
  it('returns a CryptoKey', async () => {
    const key = await importVaultKey(fakeRawKey());
    expect(key).toBeDefined();
    expect(typeof key).toBe('object');
  });

  it('key.extractable is false (non-extractable invariant)', async () => {
    const key = await importVaultKey(fakeRawKey());
    expect(key.extractable).toBe(false);
  });

  it('key algorithm is AES-GCM with 256-bit length', async () => {
    const key = await importVaultKey(fakeRawKey());
    expect((key.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it('key usages include encrypt and decrypt only', async () => {
    const key = await importVaultKey(fakeRawKey());
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
    expect(key.usages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// useArgon2Worker — composed from the two above
// ---------------------------------------------------------------------------
describe('useArgon2Worker (composed)', () => {
  it('returns a non-extractable CryptoKey', async () => {
    const promise = useArgon2Worker('master', 'ab'.repeat(32));
    workerOnMessage!({ data: fakeRawKey() } as MessageEvent<ArrayBuffer>);
    const key = await promise;
    expect(key.extractable).toBe(false);
    expect((key.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM');
  });

  it('two different raw keys produce different CryptoKeys (encrypt round-trip mismatch)', async () => {
    const rawA = new ArrayBuffer(32);
    new Uint8Array(rawA).fill(0x01);
    const rawB = new ArrayBuffer(32);
    new Uint8Array(rawB).fill(0x02);

    // importVaultKey does not use the Worker — call it directly.
    const keyA = await importVaultKey(rawA);
    const keyB = await importVaultKey(rawB);

    const plaintext = new TextEncoder().encode('test-payload');
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt with keyA, try to decrypt with keyB — must fail (auth tag mismatch).
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyA, plaintext);
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyB, ciphertext),
    ).rejects.toThrow();
  });
});
