// PoW challenge solver — runs in browser/extension Web Worker.
// Contract: SHA-256(challenge + nonce), nonce as decimal string, no separator.
// 4 leading hex zeros = difficulty 4 (matches server's verifyAndConsume check).

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function solvePoW(challenge: string, difficulty: number): Promise<string> {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    const hash = await sha256hex(challenge + nonce.toString());
    if (hash.startsWith(target)) return nonce.toString();
    nonce++;
  }
}
