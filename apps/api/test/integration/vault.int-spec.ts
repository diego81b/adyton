import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';

let app: NestFastifyApplication;

const REGISTER_URL = '/api/auth/register';
const VAULT_URL = '/api/vault';

const USER_A = { email: 'vault-a@adyton.test', password: 'vaultPasswordA123' };
const USER_B = { email: 'vault-b@adyton.test', password: 'vaultPasswordB123' };

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const BASE_ENTRY = {
  entryType: 'LOGIN',
  encryptedData: 'base64-ciphertext-v1',
  iv: 'base64-iv-v1',
  authTag: 'base64-tag-v1',
  labelHash: sha256('github.com'),
};

async function registerAndToken(payload: typeof USER_A): Promise<string> {
  const resp = await app.inject({ method: 'POST', url: REGISTER_URL, payload });
  return resp.json<{ accessToken: string }>().accessToken;
}

async function createEntry(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const resp = await app.inject({
    method: 'POST',
    url: VAULT_URL,
    headers: { authorization: `Bearer ${token}` },
    payload: { ...BASE_ENTRY, ...overrides },
  });
  return resp.json<{ id: string }>();
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
describe('GET /api/vault — unauthenticated', () => {
  it('returns 401 without bearer token', async () => {
    const resp = await app.inject({ method: 'GET', url: VAULT_URL });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/vault — create entry', () => {
  it('creates entry and returns 201 with correct fields', async () => {
    const token = await registerAndToken(USER_A);

    const resp = await app.inject({
      method: 'POST',
      url: VAULT_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: BASE_ENTRY,
    });

    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ id: string; entryType: string; version: number; labelHash: string }>();
    expect(body.id).toBeDefined();
    expect(body.entryType).toBe('LOGIN');
    expect(body.version).toBe(1);
    expect(body.labelHash).toBe(sha256('github.com'));
  });

  it('accepts ENV_FILE with environmentTag', async () => {
    const token = await registerAndToken(USER_A);

    const resp = await app.inject({
      method: 'POST',
      url: VAULT_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...BASE_ENTRY,
        entryType: 'ENV_FILE',
        labelHash: sha256('.env.production'),
        environmentTag: 'production',
      },
    });

    expect(resp.statusCode).toBe(201);
    expect(resp.json<{ environmentTag: string }>().environmentTag).toBe('production');
  });

  it('returns 400 when labelHash is not 64 hex chars', async () => {
    const token = await registerAndToken(USER_A);
    const resp = await app.inject({
      method: 'POST',
      url: VAULT_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_ENTRY, labelHash: 'tooshort' },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 400 for invalid entryType', async () => {
    const token = await registerAndToken(USER_A);
    const resp = await app.inject({
      method: 'POST',
      url: VAULT_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_ENTRY, entryType: 'UNKNOWN_TYPE' },
    });
    expect(resp.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/vault — list', () => {
  it('returns empty list for new user', async () => {
    const token = await registerAndToken(USER_A);

    const resp = await app.inject({
      method: 'GET',
      url: VAULT_URL,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ data: unknown[]; hasMore: boolean; nextCursor: string | null }>();
    expect(body.data).toHaveLength(0);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('lists only entries belonging to authenticated user', async () => {
    const tokenA = await registerAndToken(USER_A);
    const tokenB = await registerAndToken(USER_B);

    await createEntry(tokenA, { labelHash: sha256('entry-a') });
    await createEntry(tokenB, { labelHash: sha256('entry-b') });

    const resp = await app.inject({
      method: 'GET',
      url: VAULT_URL,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    const body = resp.json<{ data: { id: string }[] }>();
    expect(body.data).toHaveLength(1);
  });

  it('filters by entryType', async () => {
    const token = await registerAndToken(USER_A);
    await createEntry(token, { entryType: 'LOGIN', labelHash: sha256('login-1') });
    await createEntry(token, { entryType: 'SECURE_NOTE', labelHash: sha256('note-1') });

    const resp = await app.inject({
      method: 'GET',
      url: `${VAULT_URL}?type=SECURE_NOTE`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = resp.json<{ data: { entryType: string }[] }>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].entryType).toBe('SECURE_NOTE');
  });

  it('paginates with cursor', async () => {
    const token = await registerAndToken(USER_A);
    for (let i = 0; i < 3; i++) {
      await createEntry(token, { labelHash: sha256(`entry-${i}`) });
    }

    const page1 = await app.inject({
      method: 'GET',
      url: `${VAULT_URL}?limit=2`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body1 = page1.json<{ data: unknown[]; hasMore: boolean; nextCursor: string }>();
    expect(body1.data).toHaveLength(2);
    expect(body1.hasMore).toBe(true);
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET',
      url: `${VAULT_URL}?limit=2&cursor=${body1.nextCursor}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body2 = page2.json<{ data: unknown[]; hasMore: boolean }>();
    expect(body2.data).toHaveLength(1);
    expect(body2.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/vault/:id — single entry', () => {
  it('returns entry for owner', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    const resp = await app.inject({
      method: 'GET',
      url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resp.statusCode).toBe(200);
    expect(resp.json<{ id: string }>().id).toBe(id);
  });

  it('returns 404 for non-existent entry', async () => {
    const token = await registerAndToken(USER_A);
    const resp = await app.inject({
      method: 'GET',
      url: `${VAULT_URL}/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(404);
  });

  it('returns 404 when user B requests user A entry — no information leak', async () => {
    const tokenA = await registerAndToken(USER_A);
    const tokenB = await registerAndToken(USER_B);
    const { id } = await createEntry(tokenA);

    const resp = await app.inject({
      method: 'GET',
      url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resp.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /api/vault/:id — update', () => {
  it('updates encrypted fields and increments version', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    const resp = await app.inject({
      method: 'PATCH',
      url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { encryptedData: 'new-cipher', iv: 'new-iv', authTag: 'new-tag' },
    });

    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ version: number; encryptedData: string }>();
    expect(body.version).toBe(2);
    expect(body.encryptedData).toBe('new-cipher');
  });

  it('returns 404 when user B updates user A entry', async () => {
    const tokenA = await registerAndToken(USER_A);
    const tokenB = await registerAndToken(USER_B);
    const { id } = await createEntry(tokenA);

    const resp = await app.inject({
      method: 'PATCH',
      url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { encryptedData: 'stolen' },
    });
    expect(resp.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/vault/:id/versions — version history', () => {
  it('returns empty array before any update', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    const resp = await app.inject({
      method: 'GET',
      url: `${VAULT_URL}/${id}/versions`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toHaveLength(0);
  });

  it('stores version snapshot on each update, ordered DESC', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    await app.inject({
      method: 'PATCH', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { encryptedData: 'v2-cipher' },
    });
    await app.inject({
      method: 'PATCH', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { encryptedData: 'v3-cipher' },
    });

    const resp = await app.inject({
      method: 'GET', url: `${VAULT_URL}/${id}/versions`,
      headers: { authorization: `Bearer ${token}` },
    });

    const versions = resp.json<{ version: number }[]>();
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBeGreaterThan(versions[1].version);
  });

  it('returns 404 for another user entry', async () => {
    const tokenA = await registerAndToken(USER_A);
    const tokenB = await registerAndToken(USER_B);
    const { id } = await createEntry(tokenA);

    const resp = await app.inject({
      method: 'GET', url: `${VAULT_URL}/${id}/versions`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resp.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/vault/:id/versions/:versionId/restore', () => {
  it('restores to previous version and increments version counter', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    await app.inject({
      method: 'PATCH', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { encryptedData: 'overwritten-cipher' },
    });

    const versionsResp = await app.inject({
      method: 'GET', url: `${VAULT_URL}/${id}/versions`,
      headers: { authorization: `Bearer ${token}` },
    });
    const versions = versionsResp.json<{ id: string; version: number; encryptedData: string }[]>();
    const v1Snapshot = versions.find((v) => v.version === 1)!;
    expect(v1Snapshot).toBeDefined();

    const restoreResp = await app.inject({
      method: 'POST',
      url: `${VAULT_URL}/${id}/versions/${v1Snapshot.id}/restore`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(restoreResp.statusCode).toBe(200);
    const restored = restoreResp.json<{ encryptedData: string; version: number }>();
    expect(restored.encryptedData).toBe(BASE_ENTRY.encryptedData);
    expect(restored.version).toBe(3);
  });

  it('returns 404 for non-existent version id', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    const resp = await app.inject({
      method: 'POST',
      url: `${VAULT_URL}/${id}/versions/00000000-0000-0000-0000-000000000000/restore`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('DELETE /api/vault/:id', () => {
  it('deletes entry and returns 204, then 404 on subsequent get', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    const delResp = await app.inject({
      method: 'DELETE', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delResp.statusCode).toBe(204);

    const getResp = await app.inject({
      method: 'GET', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getResp.statusCode).toBe(404);
  });

  it('cascade-deletes version history', async () => {
    const token = await registerAndToken(USER_A);
    const { id } = await createEntry(token);

    await app.inject({
      method: 'PATCH', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { encryptedData: 'v2' },
    });

    await app.inject({
      method: 'DELETE', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Version endpoints should 404 after entry deleted
    const versionsResp = await app.inject({
      method: 'GET', url: `${VAULT_URL}/${id}/versions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(versionsResp.statusCode).toBe(404);
  });

  it('returns 404 when user B deletes user A entry', async () => {
    const tokenA = await registerAndToken(USER_A);
    const tokenB = await registerAndToken(USER_B);
    const { id } = await createEntry(tokenA);

    const resp = await app.inject({
      method: 'DELETE', url: `${VAULT_URL}/${id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resp.statusCode).toBe(404);
  });
});
