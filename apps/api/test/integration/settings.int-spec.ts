import * as path from 'node:path';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DEFAULT_USER_SETTINGS } from '../../src/settings/user-settings.contract';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';

let app: NestFastifyApplication;

const REGISTER_URL = '/api/auth/register';
const SETTINGS_URL = '/api/settings';

const USER = { email: 'settings-user@adyton.test', password: 'passwordForSettings123' };

interface SettingsResponse {
  displayName: string;
  lockMode: string;
  lockDurationMs: number;
}

async function registerAndToken(): Promise<string> {
  const resp = await app.inject({ method: 'POST', url: REGISTER_URL, payload: USER });
  expect(resp.statusCode).toBe(201);
  return resp.json<{ accessToken: string }>().accessToken;
}

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
describe('GET /settings', () => {
  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({ method: 'GET', url: SETTINGS_URL });
    expect(resp.statusCode).toBe(401);
  });

  it('returns defaults for a freshly-registered user', async () => {
    const token = await registerAndToken();

    const resp = await app.inject({
      method: 'GET',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resp.statusCode).toBe(200);
    expect(resp.json<SettingsResponse>()).toEqual({
      displayName: DEFAULT_USER_SETTINGS.displayName,
      lockMode: DEFAULT_USER_SETTINGS.lockMode,
      lockDurationMs: DEFAULT_USER_SETTINGS.lockDurationMs,
    });
  });
});

// ---------------------------------------------------------------------------
describe('PUT /settings', () => {
  it('persists an update and returns the merged settings', async () => {
    const token = await registerAndToken();

    const putResp = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'Diego', lockMode: 'absolute', lockDurationMs: 60_000 },
    });
    expect(putResp.statusCode).toBe(200);
    expect(putResp.json<SettingsResponse>()).toEqual({
      displayName: 'Diego',
      lockMode: 'absolute',
      lockDurationMs: 60_000,
    });

    // GET reflects the persisted values.
    const getResp = await app.inject({
      method: 'GET',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getResp.json<SettingsResponse>().displayName).toBe('Diego');
  });

  it('partial update preserves previously-stored fields', async () => {
    const token = await registerAndToken();

    await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'Diego', lockDurationMs: 120_000 },
    });

    // Touch only lockMode — displayName and lockDurationMs must survive.
    const putResp = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { lockMode: 'absolute' },
    });
    expect(putResp.statusCode).toBe(200);
    expect(putResp.json<SettingsResponse>()).toEqual({
      displayName: 'Diego',
      lockMode: 'absolute',
      lockDurationMs: 120_000,
    });
  });

  it('accepts lockDurationMs of 0 (never auto-lock)', async () => {
    const token = await registerAndToken();
    const resp = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { lockDurationMs: 0 },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json<SettingsResponse>().lockDurationMs).toBe(0);
  });

  it('rejects an out-of-range lockDurationMs with 400', async () => {
    const token = await registerAndToken();
    const resp = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { lockDurationMs: 59_999 },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('rejects an unknown field with 400', async () => {
    const token = await registerAndToken();
    const resp = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { isAdmin: true },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      payload: { displayName: 'X' },
    });
    expect(resp.statusCode).toBe(401);
  });
});
