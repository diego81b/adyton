## 5. Database Layer (MikroORM 6 + PostgreSQL 16)

### 5.1 MikroORM 6 — Unit of Work Pattern

The Unit of Work pattern is the conceptual core of MikroORM's design and the primary reason it was chosen over Prisma or Drizzle for this project. MikroORM tracks all entities loaded or created within the scope of a request through an identity map — a per-request registry that maps entity identity to a single in-memory instance. Mutations to those instances are tracked as "dirty" diffs. Only when `EntityManager.flush()` is called does MikroORM compute the minimal set of SQL statements required to synchronize in-memory state to the database, wrapping them in a single transaction.

For a password manager backend, this behavior has concrete benefits. A login flow that loads a `User`, updates `lastLoginAt`, creates a `RefreshToken`, and potentially writes an `AuditLog` produces exactly one transaction on `flush()`, with all four operations atomic.

The comparison with alternatives is instructive: Prisma operates on a query-builder model where each call is a discrete database operation, offering no identity map or automatic change tracking. Drizzle is a thin SQL-builder DSL with no ORM semantics at all. MikroORM's explicit transaction API makes it the most appropriate choice for a domain with strict data integrity requirements.

In NestJS, `EntityManager` is scoped per request using `@mikro-orm/nestjs`'s request context middleware:

```typescript
// main.ts — register MikroORM request context middleware
app.use((req, res, next) => {
  RequestContext.create(orm.em, next);
});
```

### 5.2 Entity Definitions

```typescript
// user.entity.ts
@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ unique: true, length: 320 })
  email!: string;

  @Property({ hidden: true, length: 255 })
  passwordHash!: string; // Argon2id hash of auth password

  @Property({ length: 64 })
  kdfSalt!: string; // hex-encoded 32 bytes, non-secret, sent to client for vault key derivation

  @Property({ nullable: true, hidden: true, length: 512 })
  totpSecretEncrypted: string | null = null; // AES-256-GCM encrypted TOTP secret

  @Property({ default: false })
  totpEnabled: boolean = false;

  @OneToMany(() => Group, (g) => g.owner, { cascade: [Cascade.REMOVE] })
  ownedGroups = new Collection<Group>(this);

  @OneToMany(() => GroupMembership, (m) => m.user, { cascade: [Cascade.REMOVE] })
  groupMemberships = new Collection<GroupMembership>(this);

  @OneToMany(() => RefreshToken, (t) => t.user, { cascade: [Cascade.REMOVE] })
  refreshTokens = new Collection<RefreshToken>(this);

  @OneToMany(() => WebAuthnCredential, (c) => c.user, { cascade: [Cascade.REMOVE] })
  webAuthnCredentials = new Collection<WebAuthnCredential>(this);

  @OneToMany(() => TrustedDevice, (d) => d.user, { cascade: [Cascade.REMOVE] })
  trustedDevices = new Collection<TrustedDevice>(this);

  @OneToMany(() => AuditLog, (a) => a.user, { cascade: [Cascade.REMOVE] })
  auditLogs = new Collection<AuditLog>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
```

```typescript
// refresh-token.entity.ts
@Entity({ tableName: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  user!: User;

  @Property({ unique: true, length: 64, hidden: true })
  tokenHash!: string; // SHA-256 hex of the raw refresh token

  @Property({ type: 'uuid' })
  familyId!: string; // Groups token rotation chain; full family revoked on reuse detection

  @Property({ nullable: true })
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
```

```typescript
// group.entity.ts
@Entity({ tableName: 'groups' })
export class Group {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  owner!: User;

  @Property({ length: 255 })
  name!: string; // plaintext — group names are non-sensitive folder labels

  @Property({ nullable: true, length: 7 })
  color: string | null = null; // hex color, e.g. '#6366f1'

  @Property({ nullable: true, length: 64 })
  icon: string | null = null; // icon identifier for UI

  @OneToMany(() => GroupMembership, (m) => m.group, { cascade: [Cascade.REMOVE] })
  memberships = new Collection<GroupMembership>(this);

  @OneToMany(() => Secret, (s) => s.group, { cascade: [Cascade.REMOVE] })
  secrets = new Collection<Secret>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
```

```typescript
// group-membership.entity.ts
export enum GroupRole {
  OWNER  = 'OWNER',
  ADMIN  = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

@Entity({ tableName: 'group_memberships' })
@Unique({ properties: ['group', 'user'] })
export class GroupMembership {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => Group, { onDelete: 'cascade' })
  group!: Group;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  user!: User;

  @Enum(() => GroupRole)
  role: GroupRole = GroupRole.MEMBER;

  // Group key encrypted with this member's vault key (AES-256-GCM).
  // Decrypted client-side: userKey → groupKey → secrets.
  // On member invite: owner re-encrypts groupKey with invitee's key.
  @Property({ type: 'text' })
  encryptedGroupKey!: string; // base64 AES-256-GCM ciphertext

  @Property({ length: 24 })
  groupKeyIv!: string; // base64 12-byte nonce for encryptedGroupKey

  @Property()
  joinedAt: Date = new Date();
}
```

```typescript
// secret.entity.ts
export enum SecretType {
  PASSWORD = 'PASSWORD', // login creds, credit card, note, identity — subtype encoded in encrypted payload
  FILE     = 'FILE',     // .env file, certificate, binary — filename/env in metadata (plaintext)
}

@Entity({ tableName: 'secrets' })
export class Secret {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => Group, { onDelete: 'cascade' })
  group!: Group;

  @Property({ type: 'text' })
  encryptedData!: string; // Base64 AES-256-GCM ciphertext encrypted with groupKey

  @Property({ length: 24 })
  iv!: string; // Base64 12-byte nonce

  @Property({ length: 24 })
  authTag!: string; // Base64 16-byte GCM auth tag

  @Enum(() => SecretType)
  secretType!: SecretType;

  @Property({ length: 64 })
  labelHash!: string; // SHA-256 hex of plaintext label (server-side search, no plaintext)

  // Metadata encrypted with groupKey (AES-256-GCM, same AAD: `${groupId}:${secretId}:meta`).
  // FILE payload: { filename, fileSizeBytes, mimeType?, environment? }
  // PASSWORD payload: { domain?, favicon? }
  // Decrypted client-side; server stores opaque blob.
  @Property({ type: 'text', nullable: true })
  encryptedMetadata: string | null = null; // base64 AES-GCM ciphertext

  @Property({ length: 24, nullable: true })
  metadataIv: string | null = null; // base64 12-byte nonce; null iff encryptedMetadata is null

  @Property({ default: 1 })
  version: number = 1; // incremented on every encrypted update

  @OneToMany(() => SecretVersion, (v) => v.secret, { cascade: [Cascade.REMOVE] })
  versions = new Collection<SecretVersion>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
```

```typescript
// secret-version.entity.ts
@Entity({ tableName: 'secret_versions' })
export class SecretVersion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => Secret, { onDelete: 'cascade' })
  secret!: Secret;

  @Property({ type: 'text' })
  encryptedData!: string;

  @Property({ length: 24 })
  iv!: string;

  @Property({ length: 24 })
  authTag!: string;

  @Property()
  version!: number;

  @Property({ length: 255, nullable: true })
  changeNote: string | null = null; // e.g. 'Rotated after prod deployment'

  @Property()
  createdAt: Date = new Date();
}
```

```typescript
// webauthn-credential.entity.ts
@Entity({ tableName: 'webauthn_credentials' })
export class WebAuthnCredential {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  user!: User;

  @Property({ unique: true, type: 'text' })
  credentialId!: string; // Base64url-encoded credential ID from authenticator

  @Property({ type: 'text', hidden: true })
  publicKey!: string; // COSE-encoded public key, base64url

  @Property({ default: 0 })
  signCount!: number; // Monotonic counter for clone detection

  @Property({ length: 64 })
  aaguid!: string;

  @Property({ length: 255 })
  friendlyName!: string; // User-provided label, e.g. "YubiKey 5C"

  @Property({ nullable: true })
  lastUsedAt: Date | null = null;

  @Property()
  createdAt: Date = new Date();
}
```

```typescript
// audit-log.entity.ts
export enum AuditAction {
  LOGIN_SUCCESS      = 'LOGIN_SUCCESS',
  LOGIN_FAILURE      = 'LOGIN_FAILURE',
  REGISTER           = 'REGISTER',
  LOGOUT             = 'LOGOUT',
  GROUP_CREATE       = 'GROUP_CREATE',
  GROUP_UPDATE       = 'GROUP_UPDATE',
  GROUP_DELETE       = 'GROUP_DELETE',
  GROUP_MEMBER_ADD   = 'GROUP_MEMBER_ADD',
  GROUP_MEMBER_REMOVE = 'GROUP_MEMBER_REMOVE',
  SECRET_CREATE      = 'SECRET_CREATE',
  SECRET_READ        = 'SECRET_READ',
  SECRET_UPDATE      = 'SECRET_UPDATE',
  SECRET_DELETE      = 'SECRET_DELETE',
  SECRET_VERSION_RESTORE = 'SECRET_VERSION_RESTORE',
  PASSWORD_CHANGE    = 'PASSWORD_CHANGE',
  TOTP_ENABLE        = 'TOTP_ENABLE',
  TOTP_DISABLE       = 'TOTP_DISABLE',
  WEBAUTHN_REGISTER  = 'WEBAUTHN_REGISTER',
  SESSION_REVOKE     = 'SESSION_REVOKE',
  DEVICE_TRUST       = 'DEVICE_TRUST',
  DEVICE_REVOKE      = 'DEVICE_REVOKE',
  NEW_DEVICE_ALERT   = 'NEW_DEVICE_ALERT',
  ACCOUNT_DELETE     = 'ACCOUNT_DELETE',
}

@Entity({ tableName: 'audit_logs' })
export class AuditLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade', nullable: true })
  user: User | null = null; // nullable for failed login attempts with unknown email

  @Enum(() => AuditAction)
  action!: AuditAction;

  @Property({ length: 45 })
  ipAddress!: string;

  @Property({ length: 512 })
  userAgent!: string;

  @Property({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null; // non-sensitive context

  @Property()
  createdAt: Date = new Date();
}
```

### 5.3 Indexes and Constraints

| Index | Type | Query it serves |
|-------|------|-----------------|
| `users.email` | Unique B-tree | Login and registration lookup |
| `refresh_tokens.tokenHash` | Unique B-tree | Every refresh request lookup (sub-ms) |
| `refresh_tokens.(familyId, userId)` | Composite B-tree | Family revocation on token reuse detection |
| `group_memberships.(groupId, userId)` | Unique composite | Membership existence check + group access guard |
| `group_memberships.(userId)` | B-tree | List all groups for a user |
| `secrets.(groupId, createdAt)` | Composite B-tree | Cursor pagination: `WHERE groupId = $1 AND createdAt > $2` |
| `secrets.labelHash` | B-tree | Label search within a group (server-side, no plaintext) |
| `secret_versions.(secretId, version)` | Composite B-tree | Version history lookup + restore |
| `audit_logs.(userId, createdAt)` | Composite B-tree | Audit history in reverse chronological order |

All foreign key relationships are defined with `ON DELETE CASCADE` at the database level. The `pgcrypto` extension provides `gen_random_uuid()`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 5.4 Migration Strategy

MikroORM's migration system generates versioned SQL files from entity diff detection:

```bash
# Generate a new migration from entity changes
npx mikro-orm migration:create --name descriptive-name

# Apply pending migrations
npx mikro-orm migration:up
```

Migration files live in `apps/api/src/migrations/` and follow the naming convention `Migration{timestamp}_{name}.ts`. Generated migrations are committed to version control and treated as immutable once applied to any non-development environment.

In development, the NestJS application runs `orm.getMigrator().up()` on startup. In production, migrations run as a pre-start step in the container entrypoint:

```sh
#!/bin/sh
set -e
echo "Running database migrations..."
npx mikro-orm migration:up
echo "Migrations complete. Starting server..."
exec node dist/main.js
```

### 5.5 Cursor Pagination for Vault

Offset-based pagination degrades in two ways for a vault workload: deep pages become increasingly expensive as the database must scan and discard rows, and concurrent writes cause rows to shift position, causing entries to be skipped or duplicated across pages.

Cursor pagination anchors page position to a stable row value. The cursor encodes the `createdAt` timestamp of the last entry on the previous page. The next-page query becomes a range predicate:

```sql
SELECT * FROM secrets
WHERE group_id = $1 AND created_at > $2
ORDER BY created_at ASC
LIMIT 51; -- fetch one extra to determine hasMore
```

The `(userId, createdAt)` composite index makes this query a single index scan regardless of vault size. Fetching 51 rows when the page size is 50 allows the API to determine whether a next page exists.

```typescript
function encodeCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString('base64url');
}

function decodeCursor(cursor: string): Date {
  return new Date(Buffer.from(cursor, 'base64url').toString('utf-8'));
}
```

---

