import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { User } from './user.entity';

@Index({ properties: ['familyId', 'user'] })
@Entity({ tableName: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ unique: true, length: 64, hidden: true })
  tokenHash!: string; // SHA-256 hex of the raw refresh token

  @Property({ type: 'uuid' })
  familyId!: string; // groups rotation chain; entire family revoked on reuse detection

  @Property({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null = null;

  @Property()
  expiresAt!: Date; // now + 7 days at issuance

  @Property({ length: 45 })
  ipAddress!: string;

  @Property({ length: 512 })
  userAgent!: string;

  @Property()
  createdAt: Date = new Date();
}
