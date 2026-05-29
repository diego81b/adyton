import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from './user.entity';

@Entity({ tableName: 'webauthn_credentials' })
export class WebAuthnCredential {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ unique: true, type: 'text' })
  credentialId!: string;

  @Property({ type: 'text', hidden: true })
  publicKey!: string; // COSE-encoded public key, base64url

  @Property({ default: 0 })
  signCount!: number;

  @Property({ length: 64 })
  aaguid!: string;

  @Property({ length: 255 })
  friendlyName!: string;

  @Property({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null = null;

  @Property()
  createdAt: Date = new Date();
}
