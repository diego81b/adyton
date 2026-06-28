import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { DeviceVaultKey } from '../entities/device-vault-key.entity';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PakController } from './pak.controller';
import { PakService } from './pak.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([DeviceVaultKey]),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [PakController],
  providers: [PakService],
  exports: [PakService],
})
export class PakModule {}
