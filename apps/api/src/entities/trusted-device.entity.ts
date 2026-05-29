import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from './user.entity';

@Entity({ tableName: 'trusted_devices' })
export class TrustedDevice {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ unique: true, length: 64, hidden: true })
  deviceIdHash!: string; // SHA-256 hex of the raw device_id cookie value

  @Property({ length: 512 })
  userAgent!: string;

  @Property({ length: 45 })
  ipAddress!: string;

  @Property({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null = null;

  @Property()
  createdAt: Date = new Date();
}
