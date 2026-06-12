import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { AppModule } from './app.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ trustProxy: true, logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: process.env.NODE_ENV === 'test' ? ['error'] : undefined,
  });

  await app.register(helmet as never);
  await app.register(cookie as never);
  await app.register(cors as never, {
    origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:30000').split(',').map((o) => o.trim()),
    credentials: true,
    // @fastify/cors v11 defaults to the CORS-safelisted methods (GET,HEAD,POST) only:
    // without this, every browser PUT/PATCH/DELETE (settings update, entry edit,
    // session/device revoke, account deletion) fails its preflight with ERR_FAILED.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // Redis-backed rate limiting (falls back to in-memory if REDIS_URL not set).
  // Integration tests fire many requests per IP in well under a minute (e.g. the vault
  // version-pruning spec); a production 100/min cap would spuriously 429 them. Raise the
  // ceiling under NODE_ENV=test only — prod/staging keep 100/min. Header-presence tests
  // are unaffected (they assert headers exist, not their values).
  const rateLimitMax = process.env.NODE_ENV === 'test' ? 10_000 : 100;
  const rateLimitOptions: Record<string, unknown> = { max: rateLimitMax, timeWindow: '1 minute' };
  let rateLimitRedis: InstanceType<typeof Redis> | null = null;
  if (process.env.REDIS_URL) {
    rateLimitRedis = new Redis(process.env.REDIS_URL);
    rateLimitOptions.redis = rateLimitRedis;
  }
  await app.register(rateLimit as never, rateLimitOptions);

  // Close the rate-limit Redis client on app shutdown (not managed by NestJS DI)
  if (rateLimitRedis) {
    const rl = rateLimitRedis;
    app.getHttpAdapter().getInstance().addHook('onClose', async () => { await rl.quit(); });
  }

  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  return app;
}
