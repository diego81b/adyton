import { Migration } from '@mikro-orm/migrations';

const BASE_ACTIONS = `'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'REGISTER', 'LOGOUT', 'PASSWORD_CHANGE', 'SESSION_REVOKE', 'DEVICE_TRUST', 'DEVICE_REVOKE', 'NEW_DEVICE_ALERT', 'ACCOUNT_DELETE', 'VAULT_CREATE', 'VAULT_READ', 'VAULT_UPDATE', 'VAULT_DELETE', 'VAULT_VERSION_RESTORE'`;
const TWO_FACTOR_ACTIONS = `'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_FAILURE', 'RECOVERY_CODE_USED', 'RECOVERY_CODES_REGENERATED'`;

export class Migration20260605_add_recovery_codes extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "recovery_codes" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "code_hash" varchar(255) not null, "created_at" timestamptz not null, constraint "recovery_codes_pkey" primary key ("id"));`);
    this.addSql(`create index "recovery_codes_user_id_index" on "recovery_codes" ("user_id");`);
    this.addSql(`alter table "recovery_codes" add constraint "recovery_codes_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${BASE_ACTIONS}, ${TWO_FACTOR_ACTIONS}));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "recovery_codes" cascade;`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${BASE_ACTIONS}));`);
  }

}
