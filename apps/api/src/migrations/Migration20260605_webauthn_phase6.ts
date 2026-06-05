import { Migration } from '@mikro-orm/migrations';

const PRE_WEBAUTHN_ACTIONS = `'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'REGISTER', 'LOGOUT', 'PASSWORD_CHANGE', 'SESSION_REVOKE', 'DEVICE_TRUST', 'DEVICE_REVOKE', 'NEW_DEVICE_ALERT', 'ACCOUNT_DELETE', 'VAULT_CREATE', 'VAULT_READ', 'VAULT_UPDATE', 'VAULT_DELETE', 'VAULT_VERSION_RESTORE', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_FAILURE', 'RECOVERY_CODE_USED', 'RECOVERY_CODES_REGENERATED'`;
const WEBAUTHN_ACTIONS = `'WEBAUTHN_REGISTERED', 'WEBAUTHN_REMOVED'`;

export class Migration20260605_webauthn_phase6 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "webauthn_credentials" add column "transports" text null;`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${PRE_WEBAUTHN_ACTIONS}, ${WEBAUTHN_ACTIONS}));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "webauthn_credentials" drop column "transports";`);

    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${PRE_WEBAUTHN_ACTIONS}));`);
  }

}
