import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateSettingsDto } from './update-settings.dto';

async function validateDto(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateSettingsDto, payload);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('UpdateSettingsDto', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    expect(await validateDto({})).toEqual([]);
  });

  describe('displayName', () => {
    it('accepts a valid string and trims it', async () => {
      const dto = plainToInstance(UpdateSettingsDto, { displayName: '  Diego  ' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.displayName).toBe('Diego');
    });

    it('rejects a string longer than 64 chars (after trim)', async () => {
      const errs = await validateDto({ displayName: 'a'.repeat(65) });
      expect(errs).toContain('maxLength');
    });

    it('accepts exactly 64 chars', async () => {
      expect(await validateDto({ displayName: 'a'.repeat(64) })).toEqual([]);
    });

    it('rejects a non-string', async () => {
      const errs = await validateDto({ displayName: 123 });
      expect(errs).toContain('isString');
    });
  });

  describe('lockMode', () => {
    it.each(['activity', 'absolute'])('accepts %s', async (mode) => {
      expect(await validateDto({ lockMode: mode })).toEqual([]);
    });

    it('rejects an unknown mode', async () => {
      const errs = await validateDto({ lockMode: 'paranoid' });
      expect(errs).toContain('isIn');
    });
  });

  describe('lockDurationMs', () => {
    it.each([0, 60_000, 3_600_000, 900_000])('accepts %i', async (ms) => {
      expect(await validateDto({ lockDurationMs: ms })).toEqual([]);
    });

    it.each([59_999, 3_600_001, -1, 1.5])('rejects %p', async (ms) => {
      const errs = await validateDto({ lockDurationMs: ms });
      expect(errs).toContain('isLockDuration');
    });

    it('rejects a non-number', async () => {
      const errs = await validateDto({ lockDurationMs: '900000' });
      expect(errs).toContain('isLockDuration');
    });
  });

  it('rejects unknown fields under forbidNonWhitelisted', async () => {
    const errs = await validateDto({ isAdmin: true });
    expect(errs).toContain('whitelistValidation');
  });
});
