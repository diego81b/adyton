import { SqlEntityManager } from '@mikro-orm/postgresql';

const APP_TABLES = [
  'audit_logs',
  'trusted_devices',
  'webauthn_credentials',
  'refresh_tokens',
  'users',
];

export async function cleanDatabase(em: SqlEntityManager): Promise<void> {
  const knex = em.getKnex();
  // TRUNCATE CASCADE handles FK order automatically
  await knex.raw(`TRUNCATE TABLE ${APP_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
