import { IsObject, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';

// The attestation/assertion payloads are validated cryptographically by
// @simplewebauthn/server; DTO-level we only require a JSON object shape.

export class WebauthnRegisterVerifyDto {
  @ApiProperty({ description: 'navigator.credentials.create() response (RegistrationResponseJSON)' })
  @IsObject()
  response!: RegistrationResponseJSON;

  @ApiProperty({ example: 'YubiKey 5C', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  friendlyName!: string;
}

export class WebauthnAuthenticateOptionsDto {
  @ApiProperty({ description: 'Opaque pending-MFA token returned by POST /auth/login' })
  @Matches(/^[0-9a-f]{64}$/, { message: 'mfaToken must be a 64-char hex token' })
  mfaToken!: string;
}

export class WebauthnAuthenticateVerifyDto {
  @ApiProperty({ description: 'Opaque pending-MFA token returned by POST /auth/login' })
  @Matches(/^[0-9a-f]{64}$/, { message: 'mfaToken must be a 64-char hex token' })
  mfaToken!: string;

  @ApiProperty({ description: 'navigator.credentials.get() response (AuthenticationResponseJSON)' })
  @IsObject()
  response!: AuthenticationResponseJSON;
}
