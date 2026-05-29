import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { FastifyRequest } from 'fastify';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { CryptoService } from '../../crypto/crypto.service';

@Injectable()
export class RefreshGuard implements CanActivate {
  constructor(
    private readonly em: EntityManager,
    private readonly cryptoService: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { refreshToken?: RefreshToken }>();
    const rawToken = req.cookies?.['refreshToken'];

    if (!rawToken) {
      throw new UnauthorizedException('No refresh token');
    }

    const tokenHash = this.cryptoService.hashToken(rawToken);
    const now = new Date();

    // Two-step lookup: find by hash and not expired (regardless of revokedAt)
    const token = await this.em.findOne(
      RefreshToken,
      { tokenHash, expiresAt: { $gt: now } },
      { populate: ['user'] },
    );

    if (!token) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Family theft detection: token found but already revoked
    if (token.revokedAt !== null) {
      // Revoke entire family
      await this.em.nativeUpdate(
        RefreshToken,
        { familyId: token.familyId, user: token.user },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException('Token reuse detected');
    }

    req.refreshToken = token;
    return true;
  }
}
