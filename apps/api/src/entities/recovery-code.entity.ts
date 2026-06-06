import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { User } from './user.entity';

/**
 * One-time 2FA recovery code. Only the Argon2id hash is stored; the plaintext
 * is shown to the user exactly once at enrollment/regeneration. A consumed
 * code's row is deleted (single-use by construction).
 */
@Index({ properties: ['user'] })
@Entity({ tableName: 'recovery_codes' })
export class RecoveryCode {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ length: 255, hidden: true })
  codeHash!: string;

  @Property()
  createdAt: Date = new Date();
}
