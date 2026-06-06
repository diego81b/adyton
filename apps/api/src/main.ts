import { MikroORM } from '@mikro-orm/core';
import { createApp } from './create-app';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await createApp();

  // Auto-apply migrations only when explicitly opted in via RUN_MIGRATIONS=true.
  // - DEV: handled by the container command (`dev:migrate` runs the mikro-orm CLI under
  //   ts-node, reading src/migrations directly — immune to the dist-staleness that the
  //   watch-compiler hits on the Windows bind-mount), so RUN_MIGRATIONS stays false here.
  // - STAGING: built image with a clean dist → set RUN_MIGRATIONS=true to migrate on boot.
  // - PROD: never set → extract SQL with `pnpm --filter @adyton/api migration:sql` and
  //   apply it manually in a controlled window.
  // Gated on a dedicated flag, NOT NODE_ENV, because staging runs NODE_ENV=production
  // for parity yet must still migrate.
  if (process.env.RUN_MIGRATIONS === 'true') {
    const orm = app.get(MikroORM);
    const applied = await orm.getMigrator().up();
    console.info(`[adyton-api] migrations applied (${applied.length} run)`);
  }

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Adyton API')
      .setDescription('Self-hosted zero-knowledge vault API')
      .setVersion('0.1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addCookieAuth('refreshToken')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document, {
      jsonDocumentUrl: 'api-docs-json',
    });
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  console.info(`[adyton-api] listening on http://0.0.0.0:${port}`);
}

void bootstrap();
