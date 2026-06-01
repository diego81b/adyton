import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { VaultEntry } from '../entities/vault-entry.entity';
import { VaultEntryVersion } from '../entities/vault-entry-version.entity';
import { AuditModule } from '../audit/audit.module';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';

@Module({
  imports: [
    MikroOrmModule.forFeature([VaultEntry, VaultEntryVersion]),
    AuditModule,
  ],
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
