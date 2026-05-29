import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Redis } from 'ioredis';
import { TrustedDevice } from '../entities/trusted-device.entity';
import { User } from '../entities/user.entity';
import { CryptoService } from '../crypto/crypto.service';
import { REDIS_CLIENT } from '../redis/redis.provider';

@Injectable()
export class DevicesService {
  constructor(
    private readonly em: EntityManager,
    private readonly cryptoService: CryptoService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async listDevices(userId: string): Promise<TrustedDevice[]> {
    return this.em.find(
      TrustedDevice,
      { user: { id: userId }, revokedAt: null },
      { orderBy: { createdAt: 'DESC' } },
    );
  }

  async registerDevice(
    userId: string,
    otp: string,
    userAgent: string,
    ipAddress: string,
  ): Promise<string> {
    const redisKey = `device_otp:${otp}`;
    const storedUserId = await this.redis.get(redisKey);

    if (!storedUserId || storedUserId !== userId) {
      // Don't reveal whether the key belonged to a different user
      throw new BadRequestException('Invalid or expired device OTP');
    }

    // Delete key first (single-use)
    await this.redis.del(redisKey);

    const rawDeviceId = this.cryptoService.generateDeviceId();
    const deviceIdHash = this.cryptoService.hashToken(rawDeviceId);

    const user = this.em.getReference(User, userId);
    const device = this.em.create(TrustedDevice, {
      user,
      deviceIdHash,
      userAgent: userAgent.slice(0, 512),
      ipAddress: ipAddress.slice(0, 45),
      createdAt: new Date(),
    } as never);
    this.em.persist(device);
    await this.em.flush();

    return rawDeviceId;
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.em.findOne(
      TrustedDevice,
      { id: deviceId },
      { populate: ['user'] },
    );

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.user.id !== userId) {
      throw new ForbiddenException('Access denied');
    }

    device.revokedAt = new Date();
    await this.em.flush();
  }

  async revokeAllDevices(userId: string): Promise<void> {
    const devices = await this.em.find(TrustedDevice, {
      user: { id: userId },
      revokedAt: null,
    });

    const now = new Date();
    for (const device of devices) {
      device.revokedAt = now;
    }

    await this.em.flush();
  }
}
