import { Migration } from '@mikro-orm/migrations';

const PRE_PAK_ACTIONS = `'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'REGISTER', 'LOGOUT', 'PASSWORD_CHANGE', 'SESSION_REVOKE', 'DEVICE_TRUST', 'DEVICE_REVOKE', 'NEW_DEVICE_ALERT', 'ACCOUNT_DELETE', 'VAULT_CREATE', 'VAULT_READ', 'VAULT_UPDATE', 'VAULT_DELETE', 'VAULT_VERSION_RESTORE', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_FAILURE', 'RECOVERY_CODE_USED', 'RECOVERY_CODES_REGENERATED', 'WEBAUTHN_REGISTERED', 'WEBAUTHN_REMOVED'`;
const PAK_ACTIONS = `'PAK_DEVICE_ENROLLED', 'PAK_DEVICE_REVOKED', 'PAK_QR_APPROVED', 'PAK_QR_DENIED', 'PAK_RECOVERY_KIT_CREATED', 'PAK_RECOVERY_KIT_USED', 'EMERGENCY_FALLBACK'`;

export class Migration20260628_pak_entities extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table "device_vault_keys" (
        "id" uuid not null default gen_random_uuid(),
        "user_id" uuid not null,
        "public_key_fingerprint" varchar(64) not null,
        "device_public_key" text not null,
        "enrollment_method" varchar(32) not null check ("enrollment_method" in ('master_password','existing_device','recovery_kit')),
        "device_name" varchar(256) not null,
        "platform" varchar(32) not null check ("platform" in ('android','ios')),
        "enrolled_at" timestamptz not null default now(),
        "last_used_at" timestamptz null,
        "last_used_ip" varchar(64) null,
        "revoked_at" timestamptz null,
        "revoked_reason" varchar(32) null check ("revoked_reason" is null or "revoked_reason" in ('safe','compromised')),
        "re_cipher_completed" boolean not null default false,
        constraint "device_vault_keys_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "device_vault_keys" add constraint "device_vault_keys_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete cascade;`);
    this.addSql(`create unique index "device_vault_keys_public_key_fingerprint_unique" on "device_vault_keys" ("public_key_fingerprint");`);
    this.addSql(`create index "device_vault_keys_user_id_revoked_at_index" on "device_vault_keys" ("user_id", "revoked_at");`);

    this.addSql(`
      create table "recovery_kits" (
        "id" uuid not null default gen_random_uuid(),
        "user_id" uuid not null,
        "recovery_salt" text not null,
        "recovery_wrapped_vault_key" text not null,
        "wrap_iv" varchar(24) not null,
        "confirmed_at" timestamptz not null,
        "revoked_at" timestamptz null,
        constraint "recovery_kits_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "recovery_kits" add constraint "recovery_kits_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete cascade;`);
    this.addSql(`create unique index "recovery_kits_user_id_unique" on "recovery_kits" ("user_id");`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${PRE_PAK_ACTIONS}, ${PAK_ACTIONS}));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "device_vault_keys";`);
    this.addSql(`drop table if exists "recovery_kits";`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${PRE_PAK_ACTIONS}));`);
  }

}
