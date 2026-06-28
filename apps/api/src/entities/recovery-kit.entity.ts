import { Entity, PrimaryKey, Property, OneToOne } from '@mikro-orm/core';
import { User } from './user.entity';

@Entity({ tableName: 'recovery_kits' })
export class RecoveryKit {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @OneToOne(() => User, { deleteRule: 'cascade', owner: true })
  user!: User;

  @Property({ type: 'text' })
  recoverySalt!: string;

  @Property({ type: 'text' })
  recoveryWrappedVaultKey!: string;

  @Property({ length: 24 })
  wrapIv!: string;

  @Property()
  confirmedAt!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null = null;
}
