import { MikroORM } from '@mikro-orm/core';
import { createApp } from './create-app';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await createApp();

  if (process.env.NODE_ENV !== 'production') {
    const orm = app.get(MikroORM);
    await orm.getMigrator().up();
    console.info('[adyton-api] migrations applied');
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
