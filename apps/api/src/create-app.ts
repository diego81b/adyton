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
  });

  // Redis-backed rate limiting (falls back to in-memory if REDIS_URL not set)
  const rateLimitOptions: Record<string, unknown> = { max: 100, timeWindow: '1 minute' };
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
