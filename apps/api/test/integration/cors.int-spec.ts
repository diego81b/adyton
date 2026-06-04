import * as path from 'node:path';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startContainers, stopContainers } from '../helpers/containers';
import { createApp } from '../../src/create-app';

/**
 * Regression: @fastify/cors v10 defaults to the CORS-safelisted methods
 * (GET,HEAD,POST). Every browser PUT/PATCH/DELETE (settings update, vault entry
 * edit, session/device revoke, account deletion) failed its preflight with
 * net::ERR_FAILED until the methods list was set explicitly (found in the
 * Phase 5 Step 5 browser smoke).
 */
describe('CORS preflight', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const { databaseUrl, redisUrl } = await startContainers();
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.NODE_ENV = 'test';
    process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../../secrets/jwt_private.pem');
    process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../../secrets/jwt_public.pem');

    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await stopContainers();
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('allows %s in the preflight response', async (method) => {
    const resp = await app.inject({
      method: 'OPTIONS',
      url: '/api/settings',
      headers: {
        origin: 'http://localhost:30000',
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(resp.statusCode).toBe(204);
    expect(resp.headers['access-control-allow-methods']).toContain(method);
    expect(resp.headers['access-control-allow-origin']).toBe('http://localhost:30000');
  });
});
