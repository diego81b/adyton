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
const DEVICES_URL = '/api/devices';
const DEVICES_REGISTER_URL = '/api/devices/register';

const VALID_USER = { email: 'devices@adyton.test', password: 'devicespassword123' };
const USER_B = { email: 'devices-b@adyton.test', password: 'devicespasswordB123' };

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
// Helper: register user and return accessToken + newDeviceOtp
async function registerUser(user: { email: string; password: string }): Promise<{
  accessToken: string;
  newDeviceOtp: string;
}> {
  const resp = await app.inject({
    method: 'POST',
    url: REGISTER_URL,
    payload: user,
  });
  expect(resp.statusCode).toBe(201);
  const body = resp.json<{ accessToken: string; newDeviceOtp: string }>();
  expect(body.accessToken).toBeDefined();
  expect(body.newDeviceOtp).toBeDefined();
  return { accessToken: body.accessToken, newDeviceOtp: body.newDeviceOtp };
}

// Helper: register device using OTP, returns rawDeviceId cookie value
async function registerDevice(accessToken: string, otp: string): Promise<string> {
  const resp = await app.inject({
    method: 'POST',
    url: DEVICES_REGISTER_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { otp },
  });
  expect(resp.statusCode).toBe(201);
  const body = resp.json<{ deviceId: string }>();
  expect(body.deviceId).toBeDefined();

  const deviceCookie = resp.cookies.find((c) => c.name === 'deviceId');
  expect(deviceCookie).toBeDefined();
  expect(deviceCookie?.httpOnly).toBe(true);

  return body.deviceId;
}

// ---------------------------------------------------------------------------
describe('GET /auth/devices', () => {
  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({ method: 'GET', url: DEVICES_URL });
    expect(resp.statusCode).toBe(401);
  });

  it('returns empty array when no devices are registered', async () => {
    const { accessToken } = await registerUser(VALID_USER);

    const resp = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    const devices = resp.json<unknown[]>();
    expect(devices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('POST /auth/devices/register', () => {
  it('registers device with valid OTP — sets deviceId cookie and returns deviceId', async () => {
    const { accessToken, newDeviceOtp } = await registerUser(VALID_USER);

    const resp = await app.inject({
      method: 'POST',
      url: DEVICES_REGISTER_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { otp: newDeviceOtp },
    });

    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ deviceId: string }>();
    expect(body.deviceId).toBeDefined();

    const deviceCookie = resp.cookies.find((c) => c.name === 'deviceId');
    expect(deviceCookie).toBeDefined();
    expect(deviceCookie?.httpOnly).toBe(true);
  });

  it('returns 400 for invalid / expired OTP', async () => {
    const { accessToken } = await registerUser(VALID_USER);

    const resp = await app.inject({
      method: 'POST',
      url: DEVICES_REGISTER_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { otp: 'nonexistent-otp' },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('OTP is single-use — second redemption returns 400', async () => {
    const { accessToken, newDeviceOtp } = await registerUser(VALID_USER);

    // First use — should succeed
    await registerDevice(accessToken, newDeviceOtp);

    // Second use — should fail
    const resp = await app.inject({
      method: 'POST',
      url: DEVICES_REGISTER_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { otp: newDeviceOtp },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 400 when OTP belongs to a different user', async () => {
    // Register user A — get their OTP
    const { newDeviceOtp: otpA } = await registerUser(VALID_USER);

    // Register user B and try to use user A's OTP
    const { accessToken: tokenB } = await registerUser(USER_B);

    const resp = await app.inject({
      method: 'POST',
      url: DEVICES_REGISTER_URL,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { otp: otpA },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 400 for missing otp field', async () => {
    const { accessToken } = await registerUser(VALID_USER);

    const resp = await app.inject({
      method: 'POST',
      url: DEVICES_REGISTER_URL,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(resp.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('Full device lifecycle', () => {
  it('register → list → revoke → list', async () => {
    const { accessToken, newDeviceOtp } = await registerUser(VALID_USER);

    // Step 1: No registered devices yet
    const listResp1 = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResp1.statusCode).toBe(200);
    expect(listResp1.json<unknown[]>()).toHaveLength(0);

    // Step 2: Register device with OTP
    await registerDevice(accessToken, newDeviceOtp);

    // Step 3: List — 1 device
    const listResp2 = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResp2.statusCode).toBe(200);
    const devices = listResp2.json<Array<{ id: string; userAgent: string; ipAddress: string; createdAt: string }>>();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toHaveProperty('id');
    expect(devices[0]).toHaveProperty('userAgent');
    expect(devices[0]).toHaveProperty('ipAddress');
    // deviceIdHash must never leak
    expect(devices[0]).not.toHaveProperty('deviceIdHash');

    // Step 4: Revoke the device
    const deleteResp = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/${devices[0].id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deleteResp.statusCode).toBe(204);

    // Step 5: List — 0 devices
    const listResp3 = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResp3.json<unknown[]>()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('DELETE /auth/devices/:id', () => {
  it('returns 404 for non-existent device id', async () => {
    const { accessToken } = await registerUser(VALID_USER);

    const resp = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(404);
  });

  it('returns 403 when a different user tries to revoke another user\'s device', async () => {
    // Register user A and their device
    const { accessToken: tokenA, newDeviceOtp: otpA } = await registerUser(VALID_USER);
    await registerDevice(tokenA, otpA);

    const listResp = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const devicesA = listResp.json<Array<{ id: string }>>();
    expect(devicesA).toHaveLength(1);

    // Register user B
    const { accessToken: tokenB } = await registerUser(USER_B);

    // User B tries to delete user A's device
    const deleteResp = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/${devicesA[0].id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(deleteResp.statusCode).toBe(403);
  });

  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({
      method: 'DELETE',
      url: `${DEVICES_URL}/some-id`,
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('DELETE /auth/devices (revoke all)', () => {
  it('revokes all devices in one request', async () => {
    const { accessToken, newDeviceOtp } = await registerUser(VALID_USER);

    // Register one device
    await registerDevice(accessToken, newDeviceOtp);

    // Login again to get a second OTP
    const loginResp = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: VALID_USER,
    });
    expect(loginResp.statusCode).toBe(200);
    const { newDeviceOtp: otp2 } = loginResp.json<{ newDeviceOtp: string }>();
    await registerDevice(accessToken, otp2);

    // List — should have 2
    const listBefore = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listBefore.json<unknown[]>()).toHaveLength(2);

    // Revoke all
    const deleteAllResp = await app.inject({
      method: 'DELETE',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deleteAllResp.statusCode).toBe(204);

    // List — should have 0
    const listAfter = await app.inject({
      method: 'GET',
      url: DEVICES_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listAfter.json<unknown[]>()).toHaveLength(0);
  });

  it('returns 401 without a bearer token', async () => {
    const resp = await app.inject({ method: 'DELETE', url: DEVICES_URL });
    expect(resp.statusCode).toBe(401);
  });
});
