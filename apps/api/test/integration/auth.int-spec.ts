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
const REFRESH_URL = '/api/auth/refresh';
const LOGOUT_URL = '/api/auth/logout';
const ME_URL = '/api/auth/me';

const VALID_USER = { email: 'integration@adyton.test', password: 'integrationpassword123' };

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

  // Run migrations
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
describe('POST /auth/register', () => {
  it('registers a new user and returns accessToken + user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: VALID_USER,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ accessToken: string; user: Record<string, unknown> }>();
    expect(body.accessToken).toBeDefined();
    expect(body.user.email).toBe(VALID_USER.email.toLowerCase());
    expect(body.user.kdfSalt).toBeDefined();
    expect(body.user.totpEnabled).toBe(false);
    // refreshToken cookie should be set
    const cookies = response.cookies;
    const rtCookie = cookies.find((c) => c.name === 'refreshToken');
    expect(rtCookie).toBeDefined();
    expect(rtCookie?.httpOnly).toBe(true);
  });

  it('returns 409 on duplicate email', async () => {
    // Register once
    await app.inject({ method: 'POST', url: REGISTER_URL, payload: VALID_USER });
    // Register again
    const response = await app.inject({ method: 'POST', url: REGISTER_URL, payload: VALID_USER });
    expect(response.statusCode).toBe(409);
  });

  it('returns 400 for short password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: { email: 'x@x.com', password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /auth/login', () => {
  beforeEach(async () => {
    // Pre-register user
    await app.inject({ method: 'POST', url: REGISTER_URL, payload: VALID_USER });
  });

  it('logs in with correct credentials and returns accessToken + refreshToken cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: VALID_USER,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ accessToken: string; user: Record<string, unknown> }>();
    expect(body.accessToken).toBeDefined();
    expect(body.user.email).toBe(VALID_USER.email.toLowerCase());

    const cookies = response.cookies;
    const rtCookie = cookies.find((c) => c.name === 'refreshToken');
    expect(rtCookie).toBeDefined();
    expect(rtCookie?.httpOnly).toBe(true);
  });

  it('returns 401 for wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: { email: VALID_USER.email, password: 'wrongpassword' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: { email: 'nobody@nowhere.com', password: 'somepassword' },
    });
    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /auth/refresh', () => {
  it('rotates refresh token — new cookie, old token invalidated', async () => {
    // Register and extract refresh cookie
    const registerResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: VALID_USER,
    });
    const cookies = registerResp.cookies;
    const rtCookie = cookies.find((c) => c.name === 'refreshToken');
    expect(rtCookie).toBeDefined();
    const originalToken = rtCookie!.value;

    // Refresh with the original token
    const refreshResp = await app.inject({
      method: 'POST',
      url: REFRESH_URL,
      cookies: { refreshToken: originalToken },
    });
    expect(refreshResp.statusCode).toBe(200);
    const refreshBody = refreshResp.json<{ accessToken: string }>();
    expect(refreshBody.accessToken).toBeDefined();

    const refreshCookies = refreshResp.cookies;
    const newRtCookie = refreshCookies.find((c) => c.name === 'refreshToken');
    expect(newRtCookie).toBeDefined();
    expect(newRtCookie!.value).not.toBe(originalToken);

    // Old token should now be rejected (reuse detection)
    const reuseResp = await app.inject({
      method: 'POST',
      url: REFRESH_URL,
      cookies: { refreshToken: originalToken },
    });
    expect(reuseResp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /auth/logout', () => {
  it('clears refresh cookie on logout', async () => {
    const registerResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: VALID_USER,
    });
    const cookies = registerResp.cookies;
    const rtCookie = cookies.find((c) => c.name === 'refreshToken');
    const token = rtCookie!.value;

    const logoutResp = await app.inject({
      method: 'POST',
      url: LOGOUT_URL,
      cookies: { refreshToken: token },
    });
    expect(logoutResp.statusCode).toBe(204);

    const logoutCookies = logoutResp.cookies;
    const clearedCookie = logoutCookies.find((c) => c.name === 'refreshToken');
    expect(clearedCookie?.value).toBe('');
    expect(clearedCookie?.maxAge).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('GET /auth/me', () => {
  it('returns user profile with valid access token', async () => {
    const registerResp = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: VALID_USER,
    });
    const { accessToken } = registerResp.json<{ accessToken: string }>();

    const meResp = await app.inject({
      method: 'GET',
      url: ME_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meResp.statusCode).toBe(200);
    const body = meResp.json<{ id: string; email: string }>();
    expect(body.email).toBe(VALID_USER.email.toLowerCase());
  });

  it('returns 401 without token', async () => {
    const meResp = await app.inject({ method: 'GET', url: ME_URL });
    expect(meResp.statusCode).toBe(401);
  });
});
