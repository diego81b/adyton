import { Migration } from '@mikro-orm/migrations';

export class Migration20260601_add_metadata_auth_tag extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "vault_entries" add column "metadata_auth_tag" varchar(64) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "vault_entries" drop column "metadata_auth_tag";`);
  }

}
