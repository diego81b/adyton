import * as path from 'node:path';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { generate } from 'otplib';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';
import { User } from '../../src/entities/user.entity';
import { WebAuthnCredential } from '../../src/entities/webauthn-credential.entity';

let app: NestFastifyApplication;

const EMAIL = 'webauthn-int@adyton.test';
const EMAIL_B = 'webauthn-int-b@adyton.test';
const PASSWORD = 'WebAuthnIntegration123!';

const REGISTER_URL = '/api/auth/register';
const LOGIN_URL = '/api/auth/login';
const SETUP_URL = '/api/auth/2fa/setup';
const ENABLE_URL = '/api/auth/2fa/enable';
const WA_REGISTER_OPTIONS_URL = '/api/auth/webauthn/register/options';
const WA_REGISTER_VERIFY_URL = '/api/auth/webauthn/register/verify';
const WA_CREDENTIALS_URL = '/api/auth/webauthn/credentials';
const WA_AUTH_OPTIONS_URL = '/api/auth/webauthn/authenticate/options';
const WA_AUTH_VERIFY_URL = '/api/auth/webauthn/authenticate/verify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function registerUser(email = EMAIL, password = PASSWORD) {
  const resp = await app.inject({ method: 'POST', url: REGISTER_URL, payload: { email, password } });
  expect(resp.statusCode).toBe(201);
  return resp.json<{ accessToken: string; user: { id: string } }>();
}

async function enableTotp(accessToken: string) {
  const setupResp = await app.inject({
    method: 'POST',
    url: SETUP_URL,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(setupResp.statusCode).toBe(200);
  const { secret } = setupResp.json<{ secret: string }>();

  const code = await generate({ secret });
  const enableResp = await app.inject({
    method: 'POST',
    url: ENABLE_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { code },
  });
  expect(enableResp.statusCode).toBe(200);
  return { secret };
}

async function loginGetMfaToken(email = EMAIL, password = PASSWORD) {
  const resp = await app.inject({ method: 'POST', url: LOGIN_URL, payload: { email, password } });
  expect(resp.statusCode).toBe(200);
  const body = resp.json<{ requiresMfa: boolean; mfaToken: string }>();
  expect(body.requiresMfa).toBe(true);
  return body.mfaToken;
}

async function insertFakeCredential(userEmail: string, credentialId = 'test-cred-id-abc123') {
  const em = app.get(SqlEntityManager);
  const fork = em.fork();
  const user = await fork.findOneOrFail(User, { email: userEmail.toLowerCase() });
  const credential = fork.create(WebAuthnCredential, {
    user,
    credentialId,
    publicKey: Buffer.from('fake-public-key-data').toString('base64url'),
    signCount: 0,
    aaguid: '00000000-0000-0000-0000-000000000000',
    friendlyName: 'Test Key',
    transports: null,
    createdAt: new Date(),
  } as never);
  await fork.persistAndFlush(credential);
  return credential;
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
  // Use hex env var so int tests run without a local key file (unblocks CI)
  process.env.TOTP_ENC_KEY = 'a'.repeat(64);

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
// POST /auth/webauthn/register/options
// ---------------------------------------------------------------------------

describe('POST /auth/webauthn/register/options', () => {
  it('returns 400 when TOTP is not enabled', async () => {
    const { accessToken } = await registerUser();
    const resp = await app.inject({
      method: 'POST',
      url: WA_REGISTER_OPTIONS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 200 with challenge when TOTP is enabled', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);

    const resp = await app.inject({
      method: 'POST',
      url: WA_REGISTER_OPTIONS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ challenge: string; rp: { id: string } }>();
    expect(body.challenge).toBeDefined();
    expect(body.rp).toBeDefined();
  });

  it('returns 401 without JWT', async () => {
    const resp = await app.inject({ method: 'POST', url: WA_REGISTER_OPTIONS_URL });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/webauthn/register/verify
// ---------------------------------------------------------------------------

describe('POST /auth/webauthn/register/verify', () => {
  it('returns 400 when no challenge in progress (no prior options call)', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);

    const resp = await app.inject({
      method: 'POST',
      url: WA_REGISTER_VERIFY_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { response: {}, friendlyName: 'Test Key' },
    });
    // No challenge stored in Redis → service throws BadRequestException
    expect(resp.statusCode).toBe(400);
  });

  it('returns 400 for invalid attestation response', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);

    // Seed a challenge via /register/options
    await app.inject({
      method: 'POST',
      url: WA_REGISTER_OPTIONS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    // Submit garbage response — verifyRegistrationResponse will reject it
    const resp = await app.inject({
      method: 'POST',
      url: WA_REGISTER_VERIFY_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { response: {}, friendlyName: 'Test Key' },
    });
    expect(resp.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/webauthn/credentials
// ---------------------------------------------------------------------------

describe('GET /auth/webauthn/credentials', () => {
  it('returns empty list when no passkeys registered', async () => {
    const { accessToken } = await registerUser();
    const resp = await app.inject({
      method: 'GET',
      url: WA_CREDENTIALS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual([]);
  });

  it('returns the registered passkey', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);
    await insertFakeCredential(EMAIL);

    const resp = await app.inject({
      method: 'GET',
      url: WA_CREDENTIALS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<Array<{ id: string; friendlyName: string }>>();
    expect(body).toHaveLength(1);
    expect(body[0].friendlyName).toBe('Test Key');
  });

  it('returns 401 without JWT', async () => {
    const resp = await app.inject({ method: 'GET', url: WA_CREDENTIALS_URL });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /auth/webauthn/credentials/:id
// ---------------------------------------------------------------------------

describe('DELETE /auth/webauthn/credentials/:id', () => {
  it('returns 404 for non-existent credential', async () => {
    const { accessToken } = await registerUser();
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const resp = await app.inject({
      method: 'DELETE',
      url: `${WA_CREDENTIALS_URL}/${fakeId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(404);
  });

  it('deletes a credential belonging to the requesting user', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);
    const credential = await insertFakeCredential(EMAIL);

    const resp = await app.inject({
      method: 'DELETE',
      url: `${WA_CREDENTIALS_URL}/${credential.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(204);

    // Verify it's gone
    const listResp = await app.inject({
      method: 'GET',
      url: WA_CREDENTIALS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResp.json()).toEqual([]);
  });

  it('returns 403 when credential belongs to a different user', async () => {
    const { accessToken: tokenA } = await registerUser(EMAIL);
    await enableTotp(tokenA);
    const credential = await insertFakeCredential(EMAIL);

    const { accessToken: tokenB } = await registerUser(EMAIL_B);
    const resp = await app.inject({
      method: 'DELETE',
      url: `${WA_CREDENTIALS_URL}/${credential.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resp.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/webauthn/authenticate/options
// ---------------------------------------------------------------------------

describe('POST /auth/webauthn/authenticate/options', () => {
  it('returns 401 for invalid mfaToken', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: WA_AUTH_OPTIONS_URL,
      payload: { mfaToken: 'b'.repeat(64) },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 401 when user has no registered passkeys', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);
    const mfaToken = await loginGetMfaToken();

    const resp = await app.inject({
      method: 'POST',
      url: WA_AUTH_OPTIONS_URL,
      payload: { mfaToken },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 200 with challenge when mfaToken valid and passkey registered', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);
    await insertFakeCredential(EMAIL);
    const mfaToken = await loginGetMfaToken();

    const resp = await app.inject({
      method: 'POST',
      url: WA_AUTH_OPTIONS_URL,
      payload: { mfaToken },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ challenge: string; allowCredentials: unknown[] }>();
    expect(body.challenge).toBeDefined();
    expect(body.allowCredentials).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/webauthn/authenticate/verify
// ---------------------------------------------------------------------------

describe('POST /auth/webauthn/authenticate/verify', () => {
  it('returns 401 for invalid mfaToken', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: WA_AUTH_VERIFY_URL,
      payload: { mfaToken: 'c'.repeat(64), response: {} },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 401 when challenge has not been requested', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);
    await insertFakeCredential(EMAIL);
    const mfaToken = await loginGetMfaToken();

    // No /authenticate/options call → no challenge in Redis
    const resp = await app.inject({
      method: 'POST',
      url: WA_AUTH_VERIFY_URL,
      payload: { mfaToken, response: { id: 'test-cred-id-abc123', type: 'public-key' } },
    });
    // Service increments attempt then finds no challenge → 401
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Rate-limit response headers
// ---------------------------------------------------------------------------

describe('rate-limit headers', () => {
  it('x-ratelimit-* headers present on /auth/webauthn/register/options', async () => {
    const { accessToken } = await registerUser();
    await enableTotp(accessToken);

    const resp = await app.inject({
      method: 'POST',
      url: WA_REGISTER_OPTIONS_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers['x-ratelimit-limit']).toBeDefined();
    expect(resp.headers['x-ratelimit-remaining']).toBeDefined();
    expect(resp.headers['x-ratelimit-reset']).toBeDefined();
  });
});
