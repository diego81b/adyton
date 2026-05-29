import * as path from 'node:path';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';

let app: NestFastifyApplication;

const REGISTER_URL = '/api/auth/register';
const LOGIN_URL = '/api/auth/login';
const SESSIONS_URL = '/api/sessions';

const USER_A = { email: 'user-a@adyton.test', password: 'passwordforUserA123' };
const USER_B = { email: 'user-b@adyton.test', password: 'passwordforUserB123' };

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
describe('GET /auth/sessions', () => {
  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({ method: 'GET', url: SESSIONS_URL });
    expect(resp.statusCode).toBe(401);
  });

  it('lists all active sessions for the authenticated user', async () => {
    // Register (session 1)
    const registerResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: USER_A,
    });
    expect(registerResp.statusCode).toBe(201);
    const { accessToken } = registerResp.json<{ accessToken: string }>();

    // Login again (session 2)
    const loginResp = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: USER_A,
    });
    expect(loginResp.statusCode).toBe(200);

    // Should see 2 sessions
    const listResp = await app.inject({
      method: 'GET',
      url: SESSIONS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResp.statusCode).toBe(200);
    const sessions = listResp.json<Array<{ id: string; ipAddress: string; userAgent: string; createdAt: string; expiresAt: string; familyId: string }>>();
    expect(sessions).toHaveLength(2);
    // Verify shape of first result
    expect(sessions[0]).toHaveProperty('id');
    expect(sessions[0]).toHaveProperty('familyId');
    expect(sessions[0]).toHaveProperty('ipAddress');
    expect(sessions[0]).toHaveProperty('userAgent');
    expect(sessions[0]).toHaveProperty('createdAt');
    expect(sessions[0]).toHaveProperty('expiresAt');
    // tokenHash must never leak
    expect(sessions[0]).not.toHaveProperty('tokenHash');
  });
});

// ---------------------------------------------------------------------------
describe('DELETE /auth/sessions/:id', () => {
  it('revokes a session — subsequent list shows one fewer session', async () => {
    // Register (session 1)
    const registerResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: USER_A,
    });
    const { accessToken } = registerResp.json<{ accessToken: string }>();

    // Login (session 2)
    await app.inject({ method: 'POST', url: LOGIN_URL, payload: USER_A });

    // List — expect 2
    const listResp1 = await app.inject({
      method: 'GET',
      url: SESSIONS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const sessions = listResp1.json<Array<{ id: string }>>();
    expect(sessions).toHaveLength(2);

    // Revoke first session
    const deleteResp = await app.inject({
      method: 'DELETE',
      url: `${SESSIONS_URL}/${sessions[0].id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deleteResp.statusCode).toBe(204);

    // List — expect 1
    const listResp2 = await app.inject({
      method: 'GET',
      url: SESSIONS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const remaining = listResp2.json<Array<{ id: string }>>();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(sessions[1].id);
  });

  it('returns 404 when session id does not exist', async () => {
    const registerResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: USER_A,
    });
    const { accessToken } = registerResp.json<{ accessToken: string }>();

    const resp = await app.inject({
      method: 'DELETE',
      url: `${SESSIONS_URL}/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(404);
  });

  it('returns 403 when a different user tries to revoke another user\'s session', async () => {
    // Register User A and get their session id
    const regAResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: USER_A,
    });
    const { accessToken: tokenA } = regAResp.json<{ accessToken: string }>();

    const listAResp = await app.inject({
      method: 'GET',
      url: SESSIONS_URL,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const sessionsA = listAResp.json<Array<{ id: string }>>();
    expect(sessionsA).toHaveLength(1);
    const sessionAId = sessionsA[0].id;

    // Register User B
    const regBResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: USER_B,
    });
    const { accessToken: tokenB } = regBResp.json<{ accessToken: string }>();

    // User B tries to delete User A's session
    const deleteResp = await app.inject({
      method: 'DELETE',
      url: `${SESSIONS_URL}/${sessionAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(deleteResp.statusCode).toBe(403);
  });

  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({
      method: 'DELETE',
      url: `${SESSIONS_URL}/some-id`,
    });
    expect(resp.statusCode).toBe(401);
  });
});
