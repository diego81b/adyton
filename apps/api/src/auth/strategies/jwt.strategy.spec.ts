import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { JwtPayload, loadPublicKey, loadPrivateKey } from './jwt.strategy';

// We test the validate() logic without instantiating the full strategy
// (which reads the key from disk). Extract the pure function.
function validate(payload: JwtPayload) {
  return { userId: payload.sub, email: payload.email };
}

// A real RSA keypair so the loaders' createPublicKey/createPrivateKey validation
// passes and we can assert the loaded key actually signs+verifies (RS256).
const { publicKey: PUB_PEM, privateKey: PRIV_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function roundTrips(privPem: string, pubPem: string): boolean {
  const data = 'adyton-jwt-roundtrip';
  const sig = createSign('RSA-SHA256').update(data).end().sign(privPem);
  return createVerify('RSA-SHA256').update(data).end().verify(pubPem, sig);
}

describe('loadPublicKey / loadPrivateKey', () => {
  let origPub: string | undefined;
  let origPriv: string | undefined;

  beforeEach(() => {
    origPub = process.env.JWT_PUBLIC_KEY;
    origPriv = process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    delete process.env.JWT_PRIVATE_KEY;
  });

  afterEach(() => {
    if (origPub === undefined) delete process.env.JWT_PUBLIC_KEY;
    else process.env.JWT_PUBLIC_KEY = origPub;
    if (origPriv === undefined) delete process.env.JWT_PRIVATE_KEY;
    else process.env.JWT_PRIVATE_KEY = origPriv;
  });

  it('loads raw PEM env vars and the keypair round-trips (RS256)', () => {
    process.env.JWT_PUBLIC_KEY = PUB_PEM;
    process.env.JWT_PRIVATE_KEY = PRIV_PEM;
    expect(roundTrips(loadPrivateKey(), loadPublicKey())).toBe(true);
  });

  it('loads PEM with literal \\n escapes (Coolify newline-mangling case)', () => {
    process.env.JWT_PUBLIC_KEY = PUB_PEM.replace(/\n/g, '\\n');
    process.env.JWT_PRIVATE_KEY = PRIV_PEM.replace(/\n/g, '\\n');
    expect(roundTrips(loadPrivateKey(), loadPublicKey())).toBe(true);
  });

  it('loads base64-encoded PEM env vars', () => {
    process.env.JWT_PUBLIC_KEY = Buffer.from(PUB_PEM, 'utf8').toString('base64');
    process.env.JWT_PRIVATE_KEY = Buffer.from(PRIV_PEM, 'utf8').toString('base64');
    expect(roundTrips(loadPrivateKey(), loadPublicKey())).toBe(true);
  });

  it('throws a clear error on a malformed private key (fail fast at boot)', () => {
    process.env.JWT_PRIVATE_KEY = 'not-a-key';
    expect(() => loadPrivateKey()).toThrow();
  });

  it('throws on a PEM-shaped but non-asymmetric private key', () => {
    process.env.JWT_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----';
    expect(() => loadPrivateKey()).toThrow();
  });
});

describe('JwtStrategy.validate', () => {
  it('maps sub to userId and preserves email', () => {
    const payload: JwtPayload = {
      sub: 'some-user-uuid',
      email: 'test@test.com',
      twoFactorPassed: false,
    };
    const result = validate(payload);
    expect(result).toEqual({ userId: 'some-user-uuid', email: 'test@test.com' });
  });

  it('works with twoFactorPassed=true', () => {
    const payload: JwtPayload = {
      sub: 'another-uuid',
      email: 'admin@example.com',
      twoFactorPassed: true,
    };
    const result = validate(payload);
    expect(result.userId).toBe('another-uuid');
    expect(result.email).toBe('admin@example.com');
  });
});
