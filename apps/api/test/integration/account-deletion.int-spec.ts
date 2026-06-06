import * as path from 'node:path';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';
import { User } from '../../src/entities/user.entity';
import { RefreshToken } from '../../src/entities/refresh-token.entity';

let app: NestFastifyApplication;

const REGISTER_URL = '/api/auth/register';
const LOGIN_URL = '/api/auth/login';
const DELETE_URL = '/api/auth/account';

const USER = { email: 'delete-me@adyton.test', password: 'passwordToDelete123' };

beforeAll(async () => {
  const { databaseUrl, redisUrl } = await startContainers();
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SAMESITE = 'lax';
  process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../../secrets/jwt_private.pem');
  process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../../secrets/jwt_public.pem');

  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const orm = app.get(MikroORM);
  await orm.getMigrator().up();
}, 60_000);

beforeEach(async () => {
  const em = app.get(SqlEntityManager);
  await cleanDatabase(em.fork());
});

afterAll(async () => {
  await app.close();
  await stopContainers();
});

// ---------------------------------------------------------------------------
describe('DELETE /auth/account', () => {
  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({
      method: 'DELETE',
      url: DELETE_URL,
      payload: { password: USER.password },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 401 with a wrong password and keeps the account', async () => {
    const regResp = await app.inject({ method: 'POST', url: REGISTER_URL, payload: USER });
    const { accessToken } = regResp.json<{ accessToken: string }>();

    const resp = await app.inject({
      method: 'DELETE',
      url: DELETE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: 'definitely-wrong' },
    });
    expect(resp.statusCode).toBe(401);

    // Account still exists — login still works.
    const loginResp = await app.inject({ method: 'POST', url: LOGIN_URL, payload: USER });
    expect(loginResp.statusCode).toBe(200);
  });

  it('deletes the account on correct password, cascades to refresh tokens, and clears the cookie', async () => {
    const regResp = await app.inject({ method: 'POST', url: REGISTER_URL, payload: USER });
    const { accessToken } = regResp.json<{ accessToken: string }>();

    const em = app.get(SqlEntityManager).fork();
    const before = await em.findOneOrFail(User, { email: USER.email });
    expect(await em.count(RefreshToken, { user: before.id })).toBeGreaterThan(0);

    const resp = await app.inject({
      method: 'DELETE',
      url: DELETE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: USER.password },
    });
    expect(resp.statusCode).toBe(204);

    // Refresh cookie cleared (maxAge 0).
    const cleared = resp.cookies.find((c) => c.name === 'refreshToken');
    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe('');

    // User row gone and refresh tokens cascade-deleted.
    const em2 = app.get(SqlEntityManager).fork();
    expect(await em2.findOne(User, { email: USER.email })).toBeNull();
    expect(await em2.count(RefreshToken, { user: before.id })).toBe(0);

    // Login with the deleted credentials fails.
    const loginResp = await app.inject({ method: 'POST', url: LOGIN_URL, payload: USER });
    expect(loginResp.statusCode).toBe(401);
  });

  it('rejects an empty password with 400', async () => {
    const regResp = await app.inject({ method: 'POST', url: REGISTER_URL, payload: USER });
    const { accessToken } = regResp.json<{ accessToken: string }>();

    const resp = await app.inject({
      method: 'DELETE',
      url: DELETE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: '' },
    });
    expect(resp.statusCode).toBe(400);
  });
});
