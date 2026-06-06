import {
  Entity,
  PrimaryKey,
  Property,
  OneToMany,
  Collection,
  Cascade,
} from '@mikro-orm/core';
import type { UserSettings } from '../settings/user-settings.contract';
import { RefreshToken } from './refresh-token.entity';
import { TrustedDevice } from './trusted-device.entity';
import { WebAuthnCredential } from './webauthn-credential.entity';
import { VaultEntry } from './vault-entry.entity';
import { RecoveryCode } from './recovery-code.entity';

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ unique: true, length: 320 })
  email!: string;

  @Property({ hidden: true, length: 255 })
  passwordHash!: string;

  @Property({ length: 64 })
  kdfSalt!: string; // hex-encoded 32 bytes, non-secret, sent to client for vault key derivation

  @Property({ nullable: true, hidden: true, length: 512 })
  totpSecretEncrypted: string | null = null;

  @Property({ default: false })
  totpEnabled: boolean = false;

  // Plaintext non-secret UI preferences (display name, auto-lock mode/duration).
  // null = use DEFAULT_USER_SETTINGS; stored as a partial so new fields default cleanly.
  @Property({ type: 'json', nullable: true })
  settings: Partial<UserSettings> | null = null;

  @OneToMany(() => RefreshToken, (t) => t.user, { cascade: [Cascade.REMOVE] })
  refreshTokens = new Collection<RefreshToken>(this);

  @OneToMany(() => TrustedDevice, (d) => d.user, { cascade: [Cascade.REMOVE] })
  trustedDevices = new Collection<TrustedDevice>(this);

  @OneToMany(() => WebAuthnCredential, (c) => c.user, { cascade: [Cascade.REMOVE] })
  webAuthnCredentials = new Collection<WebAuthnCredential>(this);

  @OneToMany(() => VaultEntry, (e) => e.user, { cascade: [Cascade.REMOVE] })
  vaultEntries = new Collection<VaultEntry>(this);

  @OneToMany(() => RecoveryCode, (c) => c.user, { cascade: [Cascade.REMOVE] })
  recoveryCodes = new Collection<RecoveryCode>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
