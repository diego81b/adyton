import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

let pgContainer: StartedPostgreSqlContainer | null = null;
let redisContainer: StartedRedisContainer | null = null;

export async function startContainers(): Promise<{
  databaseUrl: string;
  redisUrl: string;
}> {
  [pgContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('adyton_test')
      .withUsername('adyton')
      .withPassword('testpassword')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  return {
    databaseUrl: pgContainer.getConnectionUri(),
    redisUrl: `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`,
  };
}

export async function stopContainers(): Promise<void> {
  await Promise.all([
    pgContainer?.stop(),
    redisContainer?.stop(),
  ]);
}
