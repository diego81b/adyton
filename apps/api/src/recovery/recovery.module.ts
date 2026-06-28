import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { RecoveryKit } from '../entities/recovery-kit.entity';
import { AuditModule } from '../audit/audit.module';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    MikroOrmModule.forFeature([RecoveryKit]),
    AuditModule,
    RedisModule,
  ],
  controllers: [RecoveryController],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
