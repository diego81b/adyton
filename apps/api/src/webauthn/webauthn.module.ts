import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { User } from '../entities/user.entity';
import { WebAuthnCredential } from '../entities/webauthn-credential.entity';
import { CryptoModule } from '../crypto/crypto.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WebauthnController } from './webauthn.controller';
import { WebauthnService } from './webauthn.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([User, WebAuthnCredential]),
    CryptoModule,
    AuditModule,
    AuthModule, // AuthService.completeLogin issues the session after the second factor
  ],
  controllers: [WebauthnController],
  providers: [WebauthnService],
})
export class WebauthnModule {}
