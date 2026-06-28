import { Entity, PrimaryKey, Property, ManyToOne, Enum, Index } from '@mikro-orm/core';
import { User } from './user.entity';

export enum PakEnrollmentMethod {
  MASTER_PASSWORD = 'master_password',
  EXISTING_DEVICE = 'existing_device',
  RECOVERY_KIT = 'recovery_kit',
}

export enum PakPlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

export enum PakRevocationReason {
  SAFE = 'safe',
  COMPROMISED = 'compromised',
}

@Index({ properties: ['user', 'revokedAt'] })
@Entity({ tableName: 'device_vault_keys' })
export class DeviceVaultKey {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ length: 64, unique: true })
  publicKeyFingerprint!: string;

  @Property({ type: 'text' })
  devicePublicKey!: string;

  @Enum({ items: () => PakEnrollmentMethod, length: 32 })
  enrollmentMethod!: PakEnrollmentMethod;

  @Property({ length: 256 })
  deviceName!: string;

  @Enum({ items: () => PakPlatform, length: 32 })
  platform!: PakPlatform;

  @Property()
  enrolledAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null = null;

  @Property({ length: 64, nullable: true })
  lastUsedIp: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null = null;

  @Enum({ items: () => PakRevocationReason, length: 32, nullable: true })
  revokedReason: PakRevocationReason | null = null;

  @Property({ default: false })
  reCipherCompleted: boolean = false;
}
