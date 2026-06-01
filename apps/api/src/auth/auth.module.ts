import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { User } from '../entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { TrustedDevice } from '../entities/trusted-device.entity';
import { CryptoModule } from '../crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ChallengeService } from './challenge/challenge.service';
import { JwtStrategy, loadPrivateKey, loadPublicKey } from './strategies/jwt.strategy';
import { RefreshGuard } from './guards/refresh.guard';
import { ProgressiveDelayService } from './progressive-delay/progressive-delay.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([User, RefreshToken, TrustedDevice]),
    JwtModule.register({
      privateKey: loadPrivateKey(),
      publicKey: loadPublicKey(),
      signOptions: { algorithm: 'RS256', expiresIn: '15m' },
      verifyOptions: { algorithms: ['RS256'] },
    }),
    PassportModule,
    CryptoModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, ChallengeService, JwtStrategy, RefreshGuard, ProgressiveDelayService],
  exports: [AuthService],
})
export class AuthModule {}
