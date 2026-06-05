import { Entity, PrimaryKey, Property, ManyToOne, Enum, Index } from '@mikro-orm/core';
import { User } from './user.entity';

export enum AuditAction {
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  REGISTER = 'REGISTER',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  SESSION_REVOKE = 'SESSION_REVOKE',
  DEVICE_TRUST = 'DEVICE_TRUST',
  DEVICE_REVOKE = 'DEVICE_REVOKE',
  NEW_DEVICE_ALERT = 'NEW_DEVICE_ALERT',
  ACCOUNT_DELETE = 'ACCOUNT_DELETE',
  VAULT_CREATE = 'VAULT_CREATE',
  VAULT_READ = 'VAULT_READ',
  VAULT_UPDATE = 'VAULT_UPDATE',
  VAULT_DELETE = 'VAULT_DELETE',
  VAULT_VERSION_RESTORE = 'VAULT_VERSION_RESTORE',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',
  TWO_FACTOR_FAILURE = 'TWO_FACTOR_FAILURE',
  RECOVERY_CODE_USED = 'RECOVERY_CODE_USED',
  RECOVERY_CODES_REGENERATED = 'RECOVERY_CODES_REGENERATED',
  WEBAUTHN_REGISTERED = 'WEBAUTHN_REGISTERED',
  WEBAUTHN_REMOVED = 'WEBAUTHN_REMOVED',
}

@Index({ properties: ['user', 'createdAt'] })
@Entity({ tableName: 'audit_logs' })
export class AuditLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { deleteRule: 'cascade', nullable: true })
  user: User | null = null; // nullable: failed login with unknown email has no user

  @Enum(() => AuditAction)
  action!: AuditAction;

  @Property({ length: 45 })
  ipAddress!: string;

  @Property({ length: 512 })
  userAgent!: string;

  @Property({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null;

  @Property()
  createdAt: Date = new Date();
}
