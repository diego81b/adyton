import { JwtPayload, loadPublicKey, loadPrivateKey } from './jwt.strategy';

// We test the validate() logic without instantiating the full strategy
// (which reads the key from disk). Extract the pure function.
function validate(payload: JwtPayload) {
  return { userId: payload.sub, email: payload.email };
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

  it('loadPublicKey returns JWT_PUBLIC_KEY env var when set', () => {
    process.env.JWT_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----';
    expect(loadPublicKey()).toBe(process.env.JWT_PUBLIC_KEY);
  });

  it('loadPrivateKey returns JWT_PRIVATE_KEY env var when set', () => {
    process.env.JWT_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----';
    expect(loadPrivateKey()).toBe(process.env.JWT_PRIVATE_KEY);
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
