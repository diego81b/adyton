import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { VaultEntry } from './vault-entry.entity';

@Index({ properties: ['entry', 'version'] })
@Entity({ tableName: 'vault_entry_versions' })
export class VaultEntryVersion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => VaultEntry, { deleteRule: 'cascade' })
  entry!: VaultEntry;

  @Property({ type: 'text' })
  encryptedData!: string;

  @Property({ length: 64 })
  iv!: string;

  @Property({ length: 64 })
  authTag!: string;

  @Property()
  version!: number;

  @Property({ length: 255, nullable: true })
  changeNote: string | null = null;

  @Property()
  createdAt: Date = new Date();
}
