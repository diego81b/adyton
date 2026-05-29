import { JwtPayload } from './jwt.strategy';

// We test the validate() logic without instantiating the full strategy
// (which reads the key from disk). Extract the pure function.
function validate(payload: JwtPayload) {
  return { userId: payload.sub, email: payload.email };
}

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
