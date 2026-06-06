import { Migration } from '@mikro-orm/migrations';

export class Migration20260604_add_user_settings extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "settings" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "settings";`);
  }

}
