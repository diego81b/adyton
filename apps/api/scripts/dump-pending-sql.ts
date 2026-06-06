/**
 * Print the SQL of all PENDING migrations WITHOUT applying them.
 *
 * This is the PRODUCTION workflow: prod never auto-migrates (RUN_MIGRATIONS is unset),
 * so a human extracts the equivalent SQL from the pending migration(s), reviews it, and
 * applies it manually against the production database during a controlled maintenance
 * window.
 *
 * Usage (reads DATABASE_URL from the environment to determine what is pending):
 *   pnpm --filter @adyton/api migration:sql
 *
 * Safe: each pending migration's `up()` only QUEUES its statements via `addSql` (the
 * migration runner is what executes them). This script reads those queued statements
 * with `getQueries()` and prints them — it never runs them, so the database is untouched.
 */
import { MikroORM, type IDatabaseDriver } from '@mikro-orm/core';
import type { Migration } from '@mikro-orm/migrations';
import config from '../src/mikro-orm.config';

type MigrationCtor = new (driver: IDatabaseDriver, config: unknown) => Migration;

async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  try {
    const migrator = orm.getMigrator();
    const pending = await migrator.getPendingMigrations();
    if (pending.length === 0) {
      console.info('-- No pending migrations. Database is up to date.');
      return;
    }

    const driver = orm.em.getDriver();
    console.info(`-- ${pending.length} pending migration(s): ${pending.map((m) => m.name).join(', ')}`);
    console.info('-- Review and apply manually. Nothing below has been executed.\n');

    for (const { name, path } of pending) {
      if (!path) continue;
      const mod = (await import(path)) as Record<string, MigrationCtor | undefined> & {
        default?: MigrationCtor;
      };
      const Ctor = mod[name] ?? mod.default;
      if (!Ctor) {
        console.info(`-- (could not load migration class "${name}" from ${path})`);
        continue;
      }
      const instance = new Ctor(driver, orm.config);
      await instance.up();
      console.info(`-- >>> ${name}`);
      for (const sql of instance.getQueries() as unknown as string[]) {
        const stmt = String(sql).trim();
        console.info(stmt.endsWith(';') ? stmt : `${stmt};`);
      }
      instance.reset();
      console.info('');
    }
  } finally {
    await orm.close(true);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
