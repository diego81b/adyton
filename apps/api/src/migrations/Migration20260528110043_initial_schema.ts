import { Migration } from '@mikro-orm/migrations';

export class Migration20260528110043_initial_schema extends Migration {

  override async up(): Promise<void> {
    this.addSql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    this.addSql(`create table "users" ("id" uuid not null default gen_random_uuid(), "email" varchar(320) not null, "password_hash" varchar(255) not null, "kdf_salt" varchar(64) not null, "totp_secret_encrypted" varchar(512) null, "totp_enabled" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`create table "trusted_devices" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "device_id_hash" varchar(64) not null, "user_agent" varchar(512) not null, "ip_address" varchar(45) not null, "last_seen_at" timestamptz null, "revoked_at" timestamptz null, "created_at" timestamptz not null, constraint "trusted_devices_pkey" primary key ("id"));`);
    this.addSql(`alter table "trusted_devices" add constraint "trusted_devices_device_id_hash_unique" unique ("device_id_hash");`);

    this.addSql(`create table "refresh_tokens" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token_hash" varchar(64) not null, "family_id" uuid not null, "revoked_at" timestamptz null, "expires_at" timestamptz not null, "ip_address" varchar(45) not null, "user_agent" varchar(512) not null, "created_at" timestamptz not null, constraint "refresh_tokens_pkey" primary key ("id"));`);
    this.addSql(`alter table "refresh_tokens" add constraint "refresh_tokens_token_hash_unique" unique ("token_hash");`);
    this.addSql(`create index "refresh_tokens_family_id_user_id_index" on "refresh_tokens" ("family_id", "user_id");`);

    this.addSql(`create table "audit_logs" ("id" uuid not null default gen_random_uuid(), "user_id" uuid null, "action" text check ("action" in ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'REGISTER', 'LOGOUT', 'PASSWORD_CHANGE', 'SESSION_REVOKE', 'DEVICE_TRUST', 'DEVICE_REVOKE', 'NEW_DEVICE_ALERT', 'ACCOUNT_DELETE')) not null, "ip_address" varchar(45) not null, "user_agent" varchar(512) not null, "metadata" jsonb null, "created_at" timestamptz not null, constraint "audit_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "audit_logs_user_id_created_at_index" on "audit_logs" ("user_id", "created_at");`);

    this.addSql(`create table "webauthn_credentials" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "credential_id" text not null, "public_key" text not null, "sign_count" int not null default 0, "aaguid" varchar(64) not null, "friendly_name" varchar(255) not null, "last_used_at" timestamptz null, "created_at" timestamptz not null, constraint "webauthn_credentials_pkey" primary key ("id"));`);
    this.addSql(`alter table "webauthn_credentials" add constraint "webauthn_credentials_credential_id_unique" unique ("credential_id");`);

    this.addSql(`alter table "trusted_devices" add constraint "trusted_devices_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "refresh_tokens" add constraint "refresh_tokens_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "audit_logs" add constraint "audit_logs_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "webauthn_credentials" add constraint "webauthn_credentials_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "trusted_devices" drop constraint "trusted_devices_user_id_foreign";`);

    this.addSql(`alter table "refresh_tokens" drop constraint "refresh_tokens_user_id_foreign";`);

    this.addSql(`alter table "audit_logs" drop constraint "audit_logs_user_id_foreign";`);

    this.addSql(`alter table "webauthn_credentials" drop constraint "webauthn_credentials_user_id_foreign";`);

    this.addSql(`drop table if exists "users" cascade;`);

    this.addSql(`drop table if exists "trusted_devices" cascade;`);

    this.addSql(`drop table if exists "refresh_tokens" cascade;`);

    this.addSql(`drop table if exists "audit_logs" cascade;`);

    this.addSql(`drop table if exists "webauthn_credentials" cascade;`);
  }

}
