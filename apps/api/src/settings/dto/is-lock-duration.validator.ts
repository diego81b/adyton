import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { LOCK_DURATION_MAX_MS, LOCK_DURATION_MIN_MS } from '../user-settings.contract';

/**
 * Valid lock durations are 0 (never auto-lock) OR an integer in
 * [LOCK_DURATION_MIN_MS, LOCK_DURATION_MAX_MS]. This is not expressible as a
 * single Min/Max pair, hence a dedicated constraint.
 */
@ValidatorConstraint({ name: 'isLockDuration', async: false })
export class IsLockDurationConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'number' || !Number.isInteger(value)) return false;
    if (value === 0) return true;
    return value >= LOCK_DURATION_MIN_MS && value <= LOCK_DURATION_MAX_MS;
  }

  defaultMessage(): string {
    return `lockDurationMs must be 0 or an integer between ${LOCK_DURATION_MIN_MS} and ${LOCK_DURATION_MAX_MS} inclusive`;
  }
}

export function IsLockDuration(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsLockDurationConstraint,
    });
  };
}
