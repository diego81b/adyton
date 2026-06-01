import { deriveRawKey } from '@adyton/shared';

interface WorkerInput {
  password: string;
  salt: Uint8Array;
}

self.onmessage = async (e: MessageEvent<WorkerInput>) => {
  const rawKey = await deriveRawKey(e.data.password, e.data.salt);
  // Transfer ownership so main thread gets the buffer without copying
  self.postMessage(rawKey, [rawKey]);
};
