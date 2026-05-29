import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';

let app: NestFastifyApplication;

const CHALLENGE_URL = '/api/auth/challenge';
const REGISTER_URL = '/api/auth/register';
const LOGIN_URL = '/api/auth/login';

const VALID_USER = { email: 'pow@adyton.test', password: 'powintegrationpassword' };

function solvePoW(challenge: string, difficulty: number): string {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    const hash = createHash('sha256').update(challenge + nonce.toString()).digest('hex');
    if (hash.startsWith(target)) return nonce.toString();
    nonce++;
  }
}

beforeAll(async () => {
  const { databaseUrl, redisUrl } = await startContainers();
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SAMESITE = 'lax';
  process.env.ENABLE_POW = 'true';
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
  delete process.env.ENABLE_POW;
});

// ---------------------------------------------------------------------------
describe('GET /auth/challenge', () => {
  it('returns 200 with correct shape when ENABLE_POW=true', async () => {
    const response = await app.inject({ method: 'GET', url: CHALLENGE_URL });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ challenge: string; difficulty: number; expiresAt: string }>();
    expect(body.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(body.difficulty).toBe(4);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
describe('POST /auth/register with ENABLE_POW=true', () => {
  it('rejects without PoW fields → 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: VALID_USER,
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepts valid PoW → 201', async () => {
    const challengeResp = await app.inject({ method: 'GET', url: CHALLENGE_URL });
    const { challenge, difficulty } = challengeResp.json<{ challenge: string; difficulty: number }>();
    const powNonce = solvePoW(challenge, difficulty);

    const response = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: { ...VALID_USER, powChallenge: challenge, powNonce },
    });
    expect(response.statusCode).toBe(201);
  });

  it('rejects replayed challenge → 400', async () => {
    const challengeResp = await app.inject({ method: 'GET', url: CHALLENGE_URL });
    const { challenge, difficulty } = challengeResp.json<{ challenge: string; difficulty: number }>();
    const powNonce = solvePoW(challenge, difficulty);

    // First use: succeeds
    await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: { ...VALID_USER, powChallenge: challenge, powNonce },
    });

    // Replay: challenge already consumed
    const replay = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: {
        email: 'other@adyton.test',
        password: 'otherpassword123',
        powChallenge: challenge,
        powNonce,
      },
    });
    expect(replay.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /auth/login with ENABLE_POW=true', () => {
  beforeEach(async () => {
    // Seed a user without PoW (register first — temporarily disable for setup)
    delete process.env.ENABLE_POW;
    await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: VALID_USER,
    });
    process.env.ENABLE_POW = 'true';
  });

  it('rejects without PoW fields → 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: VALID_USER,
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepts valid PoW → 200', async () => {
    const challengeResp = await app.inject({ method: 'GET', url: CHALLENGE_URL });
    const { challenge, difficulty } = challengeResp.json<{ challenge: string; difficulty: number }>();
    const powNonce = solvePoW(challenge, difficulty);

    const response = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: { ...VALID_USER, powChallenge: challenge, powNonce },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects replayed challenge → 400', async () => {
    const challengeResp = await app.inject({ method: 'GET', url: CHALLENGE_URL });
    const { challenge, difficulty } = challengeResp.json<{ challenge: string; difficulty: number }>();
    const powNonce = solvePoW(challenge, difficulty);

    await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: { ...VALID_USER, powChallenge: challenge, powNonce },
    });

    const replay = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: { ...VALID_USER, powChallenge: challenge, powNonce },
    });
    expect(replay.statusCode).toBe(400);
  });
});
