import { Migration } from '@mikro-orm/migrations';

const PRE_PAK_ACTIONS = `'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'REGISTER', 'LOGOUT', 'PASSWORD_CHANGE', 'SESSION_REVOKE', 'DEVICE_TRUST', 'DEVICE_REVOKE', 'NEW_DEVICE_ALERT', 'ACCOUNT_DELETE', 'VAULT_CREATE', 'VAULT_READ', 'VAULT_UPDATE', 'VAULT_DELETE', 'VAULT_VERSION_RESTORE', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_FAILURE', 'RECOVERY_CODE_USED', 'RECOVERY_CODES_REGENERATED', 'WEBAUTHN_REGISTERED', 'WEBAUTHN_REMOVED'`;
const PAK_ACTIONS = `'PAK_DEVICE_ENROLLED', 'PAK_DEVICE_REVOKED', 'PAK_QR_APPROVED', 'PAK_QR_DENIED', 'PAK_RECOVERY_KIT_CREATED', 'PAK_RECOVERY_KIT_USED', 'PAK_RECOVERY_KIT_REVOKED', 'EMERGENCY_FALLBACK'`;

export class Migration20260628_recovery_kit_revoked_action extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${PRE_PAK_ACTIONS}, ${PAK_ACTIONS}));`);
  }

  override async down(): Promise<void> {
    const PAK_ACTIONS_WITHOUT_REVOKED = `'PAK_DEVICE_ENROLLED', 'PAK_DEVICE_REVOKED', 'PAK_QR_APPROVED', 'PAK_QR_DENIED', 'PAK_RECOVERY_KIT_CREATED', 'PAK_RECOVERY_KIT_USED', 'EMERGENCY_FALLBACK'`;
    this.addSql(`alter table "audit_logs" drop constraint if exists "audit_logs_action_check";`);
    this.addSql(`alter table "audit_logs" add constraint "audit_logs_action_check" check("action" in (${PRE_PAK_ACTIONS}, ${PAK_ACTIONS_WITHOUT_REVOKED}));`);
  }

}
