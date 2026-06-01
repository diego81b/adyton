import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  OneToMany,
  Collection,
  Cascade,
  Enum,
  Index,
} from '@mikro-orm/core';
import { User } from './user.entity';
import { VaultEntryVersion } from './vault-entry-version.entity';

export enum EntryType {
  LOGIN = 'LOGIN',
  SECURE_NOTE = 'SECURE_NOTE',
  CREDIT_CARD = 'CREDIT_CARD',
  IDENTITY = 'IDENTITY',
  ENV_FILE = 'ENV_FILE',
  SECRET = 'SECRET',
}

export enum EnvironmentTag {
  PRODUCTION = 'production',
  STAGING = 'staging',
  DEVELOPMENT = 'development',
  CUSTOM = 'custom',
}

@Index({ properties: ['user', 'createdAt'] })
@Entity({ tableName: 'vault_entries' })
export class VaultEntry {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Enum(() => EntryType)
  entryType!: EntryType;

  // AES-256-GCM ciphertext (base64) encrypted with userKey
  // Phase 4 AAD: `${userId}:${entryId}`
  @Property({ type: 'text' })
  encryptedData!: string;

  @Property({ length: 64 })
  iv!: string;

  @Property({ length: 64 })
  authTag!: string;

  // SHA-256 hex of plaintext label — server-side search without revealing label
  @Index()
  @Property({ length: 64 })
  labelHash!: string;

  // Encrypted metadata (base64) — Phase 4 AAD: `${userId}:${entryId}:meta`
  @Property({ type: 'text', nullable: true })
  encryptedMetadata: string | null = null;

  @Property({ length: 64, nullable: true })
  metadataIv: string | null = null;

  @Property({ length: 64, nullable: true })
  metadataAuthTag: string | null = null;

  // Plaintext environment tag for ENV_FILE entries — never a secret
  @Enum({ items: () => EnvironmentTag, nullable: true })
  environmentTag: EnvironmentTag | null = null;

  @Property({ default: 1 })
  version: number = 1;

  @OneToMany(() => VaultEntryVersion, (v) => v.entry, { cascade: [Cascade.REMOVE] })
  versions = new Collection<VaultEntryVersion>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
