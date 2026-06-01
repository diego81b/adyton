import { Migration } from '@mikro-orm/migrations';

export class Migration20260529172416_vault_entities extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "vault_entries" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "entry_type" text check ("entry_type" in ('LOGIN', 'SECURE_NOTE', 'CREDIT_CARD', 'IDENTITY', 'ENV_FILE', 'SECRET')) not null, "encrypted_data" text not null, "iv" varchar(64) not null, "auth_tag" varchar(64) not null, "label_hash" varchar(64) not null, "encrypted_metadata" text null, "metadata_iv" varchar(64) null, "environment_tag" text check ("environment_tag" in ('production', 'staging', 'development', 'custom')) null, "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "vault_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "vault_entries_label_hash_index" on "vault_entries" ("label_hash");`);
    this.addSql(`create index "vault_entries_user_id_created_at_index" on "vault_entries" ("user_id", "created_at");`);

    this.addSql(`create table "vault_entry_versions" ("id" uuid not null default gen_random_uuid(), "entry_id" uuid not null, "encrypted_data" text not null, "iv" varchar(64) not null, "auth_tag" varchar(64) not null, "version" int not null, "change_note" varchar(255) null, "created_at" timestamptz not null, constraint "vault_entry_versions_pkey" primary key ("id"));`);
    this.addSql(`create index "vault_entry_versions_entry_id_version_index" on "vault_entry_versions" ("entry_id", "version");`);

    this.addSql(`alter table "vault_entries" add constraint "vault_entries_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "vault_entry_versions" add constraint "vault_entry_versions_entry_id_foreign" foreign key ("entry_id") references "vault_entries" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);

    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'REGISTER', 'LOGOUT', 'PASSWORD_CHANGE', 'SESSION_REVOKE', 'DEVICE_TRUST', 'DEVICE_REVOKE', 'NEW_DEVICE_ALERT', 'ACCOUNT_DELETE', 'VAULT_CREATE', 'VAULT_READ', 'VAULT_UPDATE', 'VAULT_DELETE', 'VAULT_VERSION_RESTORE'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "vault_entry_versions" drop constraint "vault_entry_versions_entry_id_foreign";`);

    this.addSql(`drop table if exists "vault_entries" cascade;`);

    this.addSql(`drop table if exists "vault_entry_versions" cascade;`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);

    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'REGISTER', 'LOGOUT', 'PASSWORD_CHANGE', 'SESSION_REVOKE', 'DEVICE_TRUST', 'DEVICE_REVOKE', 'NEW_DEVICE_ALERT', 'ACCOUNT_DELETE'));`);
  }

}
