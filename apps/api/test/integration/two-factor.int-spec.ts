import * as path from 'node:path';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { generate } from 'otplib';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';

let app: NestFastifyApplication;

const EMAIL = 'totp-int@adyton.test';
const PASSWORD = 'ToTPIntegration123!';

const REGISTER_URL = '/api/auth/register';
const LOGIN_URL = '/api/auth/login';
const SETUP_URL = '/api/auth/2fa/setup';
const ENABLE_URL = '/api/auth/2fa/enable';
const DISABLE_URL = '/api/auth/2fa/disable';
const RECOVERY_CODES_URL = '/api/auth/2fa/recovery-codes';
const AUTHENTICATE_URL = '/api/auth/2fa/authenticate';
const VAULT_URL = '/api/vault';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function registerUser(email = EMAIL, password = PASSWORD) {
  const resp = await app.inject({ method: 'POST', url: REGISTER_URL, payload: { email, password } });
  expect(resp.statusCode).toBe(201);
  return resp.json<{ accessToken: string; user: { id: string } }>();
}

async function setupTotp(accessToken: string) {
  const resp = await app.inject({
    method: 'POST',
    url: SETUP_URL,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(resp.statusCode).toBe(200);
  return resp.json<{ secret: string; otpauthUri: string; qrDataUri: string }>();
}

async function enableTotp(accessToken: string, secret: string) {
  const code = await generate({ secret });
  const resp = await app.inject({
    method: 'POST',
    url: ENABLE_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { code },
  });
  expect(resp.statusCode).toBe(200);
  return resp.json<{ recoveryCodes: string[] }>();
}

async function loginGetMfaToken(email = EMAIL, password = PASSWORD) {
  const resp = await app.inject({ method: 'POST', url: LOGIN_URL, payload: { email, password } });
  expect(resp.statusCode).toBe(200);
  const body = resp.json<{ requiresMfa: boolean; mfaToken: string }>();
  expect(body.requiresMfa).toBe(true);
  return body.mfaToken;
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const { databaseUrl, redisUrl } = await startContainers();
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SAMESITE = 'lax';
  process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../../secrets/jwt_private.pem');
  process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../../secrets/jwt_public.pem');
  // totp_enc.key is gitignored — see CLAUDE.md note on CI provisioning
  process.env.TOTP_ENC_KEY_PATH = path.resolve(__dirname, '../../../../secrets/totp_enc.key');

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
// POST /auth/2fa/setup
// ---------------------------------------------------------------------------

describe('POST /auth/2fa/setup', () => {
  it('returns secret + QR data URI for authenticated user', async () => {
    const { accessToken } = await registerUser();
    const resp = await app.inject({
      method: 'POST',
      url: SETUP_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ secret: string; otpauthUri: string; qrDataUri: string }>();
    expect(body.secret).toBeDefined();
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(body.qrDataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('returns 401 without JWT', async () => {
    const resp = await app.inject({ method: 'POST', url: SETUP_URL });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 409 if 2FA already enabled', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);

    const resp = await app.inject({
      method: 'POST',
      url: SETUP_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/2fa/enable
// ---------------------------------------------------------------------------

describe('POST /auth/2fa/enable', () => {
  it('enables 2FA and returns 8 recovery codes', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    const code = await generate({ secret });

    const resp = await app.inject({
      method: 'POST',
      url: ENABLE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ recoveryCodes: string[] }>();
    expect(body.recoveryCodes).toHaveLength(8);
    body.recoveryCodes.forEach((c) => expect(c).toMatch(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/));
  });

  it('returns 401 for wrong TOTP code', async () => {
    const { accessToken } = await registerUser();
    await setupTotp(accessToken);

    const resp = await app.inject({
      method: 'POST',
      url: ENABLE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code: '000000' },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 409 if already enabled', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);

    const code = await generate({ secret });
    const resp = await app.inject({
      method: 'POST',
      url: ENABLE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code },
    });
    expect(resp.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/2fa/disable
// ---------------------------------------------------------------------------

describe('POST /auth/2fa/disable', () => {
  it('disables 2FA with correct password', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);

    const resp = await app.inject({
      method: 'POST',
      url: DISABLE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: PASSWORD },
    });
    expect(resp.statusCode).toBe(204);
  });

  it('returns 401 for wrong password', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);

    const resp = await app.inject({
      method: 'POST',
      url: DISABLE_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: 'wrong-password' },
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/2fa/recovery-codes (regenerate)
// ---------------------------------------------------------------------------

describe('POST /auth/2fa/recovery-codes', () => {
  it('returns 8 fresh recovery codes with correct password', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    const { recoveryCodes: first } = await enableTotp(accessToken, secret);

    const resp = await app.inject({
      method: 'POST',
      url: RECOVERY_CODES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: PASSWORD },
    });
    expect(resp.statusCode).toBe(200);
    const { recoveryCodes: second } = resp.json<{ recoveryCodes: string[] }>();
    expect(second).toHaveLength(8);
    // Codes are randomly generated — they should not be identical to the first set
    expect(second.join()).not.toBe(first.join());
  });

  it('returns 401 for wrong password', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);

    const resp = await app.inject({
      method: 'POST',
      url: RECOVERY_CODES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: 'wrong' },
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/2fa/authenticate
// ---------------------------------------------------------------------------

describe('POST /auth/2fa/authenticate', () => {
  it('issues accessToken with valid mfaToken + TOTP code', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);

    const mfaToken = await loginGetMfaToken();
    const code = await generate({ secret });

    const resp = await app.inject({
      method: 'POST',
      url: AUTHENTICATE_URL,
      payload: { mfaToken, code },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ accessToken: string; user: { email: string } }>();
    expect(body.accessToken).toBeDefined();
    expect(body.user.email).toBe(EMAIL.toLowerCase());
  });

  it('issues accessToken with valid mfaToken + recovery code (single-use)', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    const { recoveryCodes } = await enableTotp(accessToken, secret);

    const mfaToken = await loginGetMfaToken();
    const resp = await app.inject({
      method: 'POST',
      url: AUTHENTICATE_URL,
      payload: { mfaToken, recoveryCode: recoveryCodes[0] },
    });
    expect(resp.statusCode).toBe(200);

    // Reuse same recovery code with a fresh mfaToken → must fail (row deleted)
    const mfaToken2 = await loginGetMfaToken();
    const reuseResp = await app.inject({
      method: 'POST',
      url: AUTHENTICATE_URL,
      payload: { mfaToken: mfaToken2, recoveryCode: recoveryCodes[0] },
    });
    expect(reuseResp.statusCode).toBe(401);
  });

  it('returns 401 for wrong TOTP code', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);
    const mfaToken = await loginGetMfaToken();

    const resp = await app.inject({
      method: 'POST',
      url: AUTHENTICATE_URL,
      payload: { mfaToken, code: '000000' },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('invalidates mfaToken after 5 wrong attempts', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);
    const mfaToken = await loginGetMfaToken();

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: AUTHENTICATE_URL,
        payload: { mfaToken, code: '000000' },
      });
    }

    // 6th attempt with a valid code — token must be invalidated by now
    const code = await generate({ secret });
    const resp = await app.inject({
      method: 'POST',
      url: AUTHENTICATE_URL,
      payload: { mfaToken, code },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 401 for invalid/expired mfaToken', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: AUTHENTICATE_URL,
      payload: { mfaToken: 'a'.repeat(64), code: '000000' },
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Security invariant: mfaToken must not pass JwtAuthGuard
// ---------------------------------------------------------------------------

describe('security: mfaToken rejected on protected routes', () => {
  it('mfaToken as Bearer → 401 on /api/vault', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);
    const mfaToken = await loginGetMfaToken();

    const resp = await app.inject({
      method: 'GET',
      url: VAULT_URL,
      headers: { authorization: `Bearer ${mfaToken}` },
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Rate-limit response headers
// ---------------------------------------------------------------------------

describe('rate-limit headers', () => {
  it('x-ratelimit-* headers present on /auth/2fa/authenticate responses', async () => {
    const { accessToken } = await registerUser();
    const { secret } = await setupTotp(accessToken);
    await enableTotp(accessToken, secret);
    const mfaToken = await loginGetMfaToken();
    const code = await generate({ secret });

    const resp = await app.inject({
      method: 'POST',
      url: AUTHENTICATE_URL,
      payload: { mfaToken, code },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers['x-ratelimit-limit']).toBeDefined();
    expect(resp.headers['x-ratelimit-remaining']).toBeDefined();
    expect(resp.headers['x-ratelimit-reset']).toBeDefined();
  });
});
