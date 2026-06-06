import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { HealthController } from './health/health.controller';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { SettingsModule } from './settings/settings.module';
import { DevicesModule } from './devices/devices.module';
import { NotificationsModule } from './notifications/notifications.module';
import { VaultModule } from './vault/vault.module';
import { AuditModule } from './audit/audit.module';
import mikroOrmBaseConfig from './mikro-orm.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // forRootAsync so DATABASE_URL is read at connection time, not at module-import time.
    // Matters for integration tests: beforeAll sets process.env.DATABASE_URL before createApp().
    MikroOrmModule.forRootAsync({
      useFactory: () => ({
        ...mikroOrmBaseConfig,
        clientUrl: process.env.DATABASE_URL ?? 'postgres://adyton:devpassword@localhost:5432/adyton',
        debug: process.env.NODE_ENV === 'development',
        logger: process.env.NODE_ENV === 'test' ? () => {} : undefined,
      }),
    }),
    RedisModule,
    AuthModule,
    SessionsModule,
    SettingsModule,
    DevicesModule,
    NotificationsModule,
    AuditModule,
    VaultModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
