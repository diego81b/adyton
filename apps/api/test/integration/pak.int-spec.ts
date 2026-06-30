import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import { startContainers, stopContainers } from '../helpers/containers';
import { cleanDatabase } from '../helpers/db-cleaner';
import { createApp } from '../../src/create-app';
import { REDIS_CLIENT } from '../../src/redis/redis.provider';

let app: NestFastifyApplication;
let redis: Redis;

const REGISTER_URL = '/api/auth/register';
const ENROLL_URL = '/api/pak/devices/enroll';
const DEVICES_URL = '/api/pak/devices';
const QR_URL = '/api/auth/qr';
const ENROLL_SESSION_URL = '/api/auth/enroll-session';

const USER_A = { email: 'pak-a@adyton.test', password: 'PakIntA123!@x' };
const USER_B = { email: 'pak-b@adyton.test', password: 'PakIntB123!@x' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function registerUser(user: { email: string; password: string }): Promise<{
  accessToken: string;
  userId: string;
}> {
  const resp = await app.inject({ method: 'POST', url: REGISTER_URL, payload: user });
  expect(resp.statusCode).toBe(201);
  const body = resp.json<{ accessToken: string; user: { id: string } }>();
  return { accessToken: body.accessToken, userId: body.user.id };
}

/** Generate a unique SPKI-like base64 string to simulate a fresh device key. */
function makeSpki(): string {
  return crypto.randomBytes(64).toString('base64');
}

function makeEnrollPayload(overrides: Partial<{
  devicePublicKeySpki: string;
  deviceName: string;
  platform: string;
  enrollmentMethod: string;
  enrollmentEphemeralPub: string;
  signature: string;
  enrollmentSessionId: string;
}> = {}) {
  return {
    devicePublicKeySpki: makeSpki(),
    deviceName: 'Test Phone',
    platform: 'android',
    enrollmentMethod: 'master_password',
    enrollmentEphemeralPub: crypto.randomBytes(32).toString('base64'),
    signature: crypto.randomBytes(64).toString('hex'),
    ...overrides,
  };
}

function makeQrPayload(deviceFingerprint: string, overrides: Partial<{
  phoneEphemeralPub: string;
  ciphertext: string;
  iv: string;
  deviceId: string;
  signature: string;
}> = {}) {
  return {
    phoneEphemeralPub: crypto.randomBytes(32).toString('base64'),
    ciphertext: crypto.randomBytes(64).toString('base64'),
    iv: crypto.randomBytes(12).toString('base64'),
    deviceId: deviceFingerprint,
    signature: crypto.randomBytes(64).toString('hex'),
    ...overrides,
  };
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

  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const orm = app.get(MikroORM);
  await orm.getMigrator().up();

  redis = app.get<Redis>(REDIS_CLIENT);
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
// POST /api/pak/devices/enroll
// ---------------------------------------------------------------------------

describe('POST /api/pak/devices/enroll', () => {
  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({ method: 'POST', url: ENROLL_URL, payload: makeEnrollPayload() });
    expect(resp.statusCode).toBe(401);
  });

  it('enrolls a device and returns 201 with device fields', async () => {
    const { accessToken } = await registerUser(USER_A);

    const resp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload({ deviceName: 'My Android' }),
    });

    expect(resp.statusCode).toBe(201);
    const body = resp.json<{
      id: string;
      deviceName: string;
      platform: string;
      enrollmentMethod: string;
      enrolledAt: string;
      lastUsedAt: string | null;
      revokedAt: string | null;
      publicKeyFingerprint: string;
    }>();
    expect(body.id).toBeDefined();
    expect(body.deviceName).toBe('My Android');
    expect(body.platform).toBe('android');
    expect(body.enrollmentMethod).toBe('master_password');
    expect(body.enrolledAt).toBeDefined();
    expect(body.lastUsedAt).toBeNull();
    expect(body.revokedAt).toBeNull();
    // publicKeyFingerprint is a 64-char hex string
    expect(body.publicKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Raw public key must never leak
    expect(body).not.toHaveProperty('devicePublicKey');
  });

  it('returns 409 on duplicate public key fingerprint', async () => {
    const { accessToken } = await registerUser(USER_A);
    const spki = makeSpki();

    const first = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload({ devicePublicKeySpki: spki }),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload({ devicePublicKeySpki: spki }),
    });
    expect(second.statusCode).toBe(409);
  });

  it('returns 429 after 5 enrollments within the rate-limit window', async () => {
    const { accessToken, userId } = await registerUser(USER_A);

    // Clear any leftover rate key from other tests
    await redis.del(`pak_enroll_rate:${userId}`);

    // Five distinct keys — should all succeed
    for (let i = 0; i < 5; i++) {
      const resp = await app.inject({
        method: 'POST',
        url: ENROLL_URL,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: makeEnrollPayload(),
      });
      expect(resp.statusCode).toBe(201);
    }

    // Sixth attempt — should be rate-limited
    const resp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload(),
    });
    expect(resp.statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// GET /api/pak/devices
// ---------------------------------------------------------------------------

describe('GET /api/pak/devices', () => {
  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({ method: 'GET', url: DEVICES_URL });
    expect(resp.statusCode).toBe(401);
  });

  it('returns only the authenticated user\'s devices', async () => {
    const { accessToken: tokenA } = await registerUser(USER_A);
    const { accessToken: tokenB } = await registerUser(USER_B);

    // Enroll one device for A and one for B
    await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: makeEnrollPayload({ deviceName: 'A Phone' }),
    });
    await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: makeEnrollPayload({ deviceName: 'B Phone' }),
    });

    const respA = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(respA.statusCode).toBe(200);
    const devicesA = respA.json<Array<{ deviceName: string }>>();
    expect(devicesA).toHaveLength(1);
    expect(devicesA[0].deviceName).toBe('A Phone');
  });

  it('returns empty array when user has no enrolled devices', async () => {
    const { accessToken } = await registerUser(USER_A);
    const resp = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json<unknown[]>()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/pak/devices/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/pak/devices/:id', () => {
  it('renames a device and returns the updated name', async () => {
    const { accessToken } = await registerUser(USER_A);

    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload({ deviceName: 'Original Name' }),
    });
    const { id } = enrollResp.json<{ id: string }>();

    const renameResp = await app.inject({
      method: 'PATCH',
      url: `${DEVICES_URL}/${id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { deviceName: 'Renamed Device' },
    });
    expect(renameResp.statusCode).toBe(200);
    expect(renameResp.json<{ deviceName: string }>().deviceName).toBe('Renamed Device');
  });

  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `${DEVICES_URL}/00000000-0000-0000-0000-000000000000`,
      payload: { deviceName: 'x' },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 404 when renaming a device belonging to another user', async () => {
    const { accessToken: tokenA } = await registerUser(USER_A);
    const { accessToken: tokenB } = await registerUser(USER_B);

    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: makeEnrollPayload(),
    });
    const { id } = enrollResp.json<{ id: string }>();

    const resp = await app.inject({
      method: 'PATCH',
      url: `${DEVICES_URL}/${id}`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { deviceName: 'Hijacked' },
    });
    expect(resp.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/pak/devices/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/pak/devices/:id', () => {
  it('revokes a device — device no longer appears in list', async () => {
    const { accessToken } = await registerUser(USER_A);

    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload(),
    });
    expect(enrollResp.statusCode).toBe(201);
    const { id } = enrollResp.json<{ id: string }>();

    const revokeResp = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/${id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(revokeResp.statusCode).toBe(204);

    const listResp = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResp.json<unknown[]>()).toHaveLength(0);
  });

  it('returns 409 on double-revoke', async () => {
    const { accessToken } = await registerUser(USER_A);

    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload(),
    });
    const { id } = enrollResp.json<{ id: string }>();

    await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/${id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    const second = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/${id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(second.statusCode).toBe(409);
  });

  it('returns 404 when revoking a device belonging to another user', async () => {
    const { accessToken: tokenA } = await registerUser(USER_A);
    const { accessToken: tokenB } = await registerUser(USER_B);

    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: makeEnrollPayload(),
    });
    const { id } = enrollResp.json<{ id: string }>();

    const resp = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/${id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resp.statusCode).toBe(404);
  });

  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/00000000-0000-0000-0000-000000000000`,
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// QR relay flow
// ---------------------------------------------------------------------------

describe('QR relay flow', () => {
  const challengeHex = 'a'.repeat(64);
  const desktopPublicKeySpki = crypto.randomBytes(64).toString('base64');

  it('issues a QR session (201) and returns sessionId + challengeHex + ttlSeconds', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: QR_URL,
      payload: { desktopPublicKeySpki, challengeHex },
    });
    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ sessionId: string; challengeHex: string; ttlSeconds: number }>();
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.challengeHex).toBe(challengeHex);
    expect(body.ttlSeconds).toBe(60);
  });

  it('poll returns pending immediately after session creation', async () => {
    const qrResp = await app.inject({
      method: 'POST',
      url: QR_URL,
      payload: { desktopPublicKeySpki, challengeHex },
    });
    const { sessionId } = qrResp.json<{ sessionId: string }>();

    const pollResp = await app.inject({
      method: 'GET',
      url: `/api/auth/qr-poll/${sessionId}`,
    });
    expect(pollResp.statusCode).toBe(200);
    expect(pollResp.json<{ status: string }>().status).toBe('pending');
  });

  it('submit relay (204) then poll returns approved with payload fields', async () => {
    const { accessToken } = await registerUser(USER_A);

    // Enroll a device to get its fingerprint
    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload(),
    });
    const { publicKeyFingerprint } = enrollResp.json<{ publicKeyFingerprint: string }>();

    // Issue QR session
    const qrResp = await app.inject({
      method: 'POST',
      url: QR_URL,
      payload: { desktopPublicKeySpki, challengeHex },
    });
    const { sessionId } = qrResp.json<{ sessionId: string }>();

    // Phone submits relay payload (requires JWT)
    const relayResp = await app.inject({
      method: 'POST',
      url: `/api/auth/qr-relay/${sessionId}`,
      headers: { authorization: `Bearer ${accessToken}`, 'user-agent': 'TestPhone/1.0' },
      payload: makeQrPayload(publicKeyFingerprint),
    });
    expect(relayResp.statusCode).toBe(204);

    // Desktop polls — should get approved with payload
    const pollResp = await app.inject({
      method: 'GET',
      url: `/api/auth/qr-poll/${sessionId}`,
    });
    expect(pollResp.statusCode).toBe(200);
    const poll = pollResp.json<{
      status: string;
      phoneEphemeralPub?: string;
      ciphertext?: string;
      iv?: string;
      deviceId?: string;
      signature?: string;
    }>();
    expect(poll.status).toBe('approved');
    expect(poll.phoneEphemeralPub).toBeDefined();
    expect(poll.ciphertext).toBeDefined();
    expect(poll.iv).toBeDefined();
    expect(poll.deviceId).toBe(publicKeyFingerprint);
    expect(poll.signature).toBeDefined();
  });

  it('submit relay to non-existent session returns 404', async () => {
    const { accessToken } = await registerUser(USER_A);

    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload(),
    });
    const { publicKeyFingerprint } = enrollResp.json<{ publicKeyFingerprint: string }>();

    const resp = await app.inject({
      method: 'POST',
      url: '/api/auth/qr-relay/00000000-0000-4000-a000-000000000000',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeQrPayload(publicKeyFingerprint),
    });
    expect(resp.statusCode).toBe(404);
  });

  it('second submit relay to an already-consumed session returns 409', async () => {
    const { accessToken } = await registerUser(USER_A);

    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload(),
    });
    const { publicKeyFingerprint } = enrollResp.json<{ publicKeyFingerprint: string }>();

    const qrResp = await app.inject({
      method: 'POST',
      url: QR_URL,
      payload: { desktopPublicKeySpki, challengeHex },
    });
    const { sessionId } = qrResp.json<{ sessionId: string }>();

    // First submit — succeeds
    await app.inject({
      method: 'POST',
      url: `/api/auth/qr-relay/${sessionId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeQrPayload(publicKeyFingerprint),
    });

    // Second submit — conflict
    const resp = await app.inject({
      method: 'POST',
      url: `/api/auth/qr-relay/${sessionId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeQrPayload(publicKeyFingerprint),
    });
    expect(resp.statusCode).toBe(409);
  });

  it('cancel QR session (204) — subsequent poll returns expired', async () => {
    const qrResp = await app.inject({
      method: 'POST',
      url: QR_URL,
      payload: { desktopPublicKeySpki, challengeHex },
    });
    const { sessionId } = qrResp.json<{ sessionId: string }>();

    const cancelResp = await app.inject({
      method: 'DELETE',
      url: `/api/auth/qr-relay/${sessionId}`,
    });
    expect(cancelResp.statusCode).toBe(204);

    const pollResp = await app.inject({
      method: 'GET',
      url: `/api/auth/qr-poll/${sessionId}`,
    });
    expect(pollResp.statusCode).toBe(200);
    expect(pollResp.json<{ status: string }>().status).toBe('expired');
  });

  it('submit relay requires JWT — returns 401 without auth', async () => {
    const qrResp = await app.inject({
      method: 'POST',
      url: QR_URL,
      payload: { desktopPublicKeySpki, challengeHex },
    });
    const { sessionId } = qrResp.json<{ sessionId: string }>();

    const resp = await app.inject({
      method: 'POST',
      url: `/api/auth/qr-relay/${sessionId}`,
      payload: {
        phoneEphemeralPub: 'pub',
        ciphertext: 'ct',
        iv: 'iv',
        deviceId: 'a'.repeat(64),
        signature: 'sig',
      },
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Enrollment session flow
// ---------------------------------------------------------------------------

describe('enrollment session flow', () => {
  it('issues an enrollment session (201) and poll returns waiting', async () => {
    const challengeHex = 'b'.repeat(64);
    const resp = await app.inject({
      method: 'POST',
      url: ENROLL_SESSION_URL,
      payload: { desktopPublicKeySpki: makeSpki(), challengeHex },
    });
    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ sessionId: string; ttlSeconds: number }>();
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.ttlSeconds).toBe(300);

    // Poll status — phone not yet connected
    const pollResp = await app.inject({
      method: 'GET',
      url: `/api/auth/enroll-status/${body.sessionId}`,
    });
    expect(pollResp.statusCode).toBe(200);
    expect(pollResp.json<{ status: string }>().status).toBe('waiting');
  });

  it('cancel enrollment session returns 204 and poll goes back to waiting', async () => {
    const challengeHex = 'c'.repeat(64);
    const sessResp = await app.inject({
      method: 'POST',
      url: ENROLL_SESSION_URL,
      payload: { desktopPublicKeySpki: makeSpki(), challengeHex },
    });
    const { sessionId } = sessResp.json<{ sessionId: string }>();

    const cancelResp = await app.inject({
      method: 'DELETE',
      url: `/api/auth/enroll-session/${sessionId}`,
    });
    expect(cancelResp.statusCode).toBe(204);

    // After cancel the session key is gone — poll returns waiting (key missing)
    const pollResp = await app.inject({
      method: 'GET',
      url: `/api/auth/enroll-status/${sessionId}`,
    });
    expect(pollResp.statusCode).toBe(200);
    expect(pollResp.json<{ status: string }>().status).toBe('waiting');
  });

  it('full enrollment session flow: issue → device enroll with sessionId → poll phone_ready', async () => {
    const { accessToken } = await registerUser(USER_A);
    const challengeHex = 'd'.repeat(64);

    // Desktop issues enrollment session
    const sessResp = await app.inject({
      method: 'POST',
      url: ENROLL_SESSION_URL,
      payload: { desktopPublicKeySpki: makeSpki(), challengeHex },
    });
    const { sessionId } = sessResp.json<{ sessionId: string }>();

    // Phone enrolls device and attaches to the session
    const enrollResp = await app.inject({
      method: 'POST',
      url: ENROLL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: makeEnrollPayload({ enrollmentSessionId: sessionId }),
    });
    expect(enrollResp.statusCode).toBe(201);

    // Desktop polls — phone is now ready
    const pollResp = await app.inject({
      method: 'GET',
      url: `/api/auth/enroll-status/${sessionId}`,
    });
    expect(pollResp.statusCode).toBe(200);
    const poll = pollResp.json<{ status: string; phoneEphemeralPub?: string; deviceId?: string }>();
    expect(poll.status).toBe('phone_ready');
    expect(poll.phoneEphemeralPub).toBeDefined();
    expect(poll.deviceId).toBeDefined();
  });
});
