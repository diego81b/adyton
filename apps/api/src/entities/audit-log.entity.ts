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
  // Phase 3 actions added later: GROUP_CREATE, SECRET_CREATE, etc.
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
