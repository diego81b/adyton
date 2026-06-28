import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';
import { DeviceVaultKey, PakEnrollmentMethod, PakPlatform, PakRevocationReason } from '../entities/device-vault-key.entity';
import { User } from '../entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../entities/audit-log.entity';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { EnrollDeviceDto, RenameDeviceDto, SubmitEnrollVaultDto } from './dto/pak.dto';
import { EnrollSessionResponseDto, EnrollStatusResponseDto, EnrollVaultStatusResponseDto, QrPollResponseDto } from './dto/pak-response.dto';

// Redis key prefixes
const QR_SESSION_PREFIX = 'pak_qr:';
const QR_PAYLOAD_PREFIX = 'pak_qr_payload:';
const QR_TTL_SECONDS = 60;
const QR_PAYLOAD_TTL_SECONDS = 30;

const ENROLL_SESSION_PREFIX = 'pak_enroll:';
const ENROLL_PHONE_PREFIX = 'pak_enroll_phone:';
const ENROLL_VAULT_PREFIX = 'pak_enroll_vault:';
const ENROLL_TTL_SECONDS = 300;
const ENROLL_VAULT_TTL_SECONDS = 60;

interface QrSessionData {
  desktopPublicKeySpki: string;
  challengeHex: string;
  createdAt: number;
  consumed: boolean;
}

interface QrPayloadData {
  phoneEphemeralPub: string;
  ciphertext: string;
  iv: string;
  deviceId: string;
  signature: string;
}

interface EnrollSessionData {
  desktopPublicKeySpki: string;
  challengeHex: string;
  createdAt: number;
}

interface EnrollPhoneData {
  phoneEphemeralPub: string;
  deviceId: string;
  userId: string;
}

interface EnrollVaultData {
  ciphertext: string;
  iv: string;
}

function toDeviceResponse(device: DeviceVaultKey) {
  return {
    id: device.id,
    deviceName: device.deviceName,
    platform: device.platform,
    enrollmentMethod: device.enrollmentMethod,
    enrolledAt: device.enrolledAt,
    lastUsedAt: device.lastUsedAt,
    revokedAt: device.revokedAt,
    publicKeyFingerprint: device.publicKeyFingerprint,
  };
}

@Injectable()
export class PakService {
  constructor(
    private readonly em: EntityManager,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issueQrSession(desktopPublicKeySpki: string, challengeHex: string): Promise<{ sessionId: string }> {
    // Validate challengeHex is 64-char hex (32 bytes)
    if (!/^[0-9a-fA-F]{64}$/.test(challengeHex)) {
      throw new ConflictException('challengeHex must be a 64-character hex string');
    }

    const sessionId = crypto.randomUUID();
    const sessionData: QrSessionData = {
      desktopPublicKeySpki,
      challengeHex,
      createdAt: Date.now(),
      consumed: false,
    };

    await this.redis.setex(
      `${QR_SESSION_PREFIX}${sessionId}`,
      QR_TTL_SECONDS,
      JSON.stringify(sessionData),
    );

    return { sessionId };
  }

  async pollQrSession(sessionId: string): Promise<QrPollResponseDto> {
    const raw = await this.redis.get(`${QR_SESSION_PREFIX}${sessionId}`);

    if (!raw) {
      return { status: 'expired' };
    }

    const session = JSON.parse(raw) as QrSessionData;

    // Check for a submitted relay payload (phone approved)
    const payloadRaw = await this.redis.get(`${QR_PAYLOAD_PREFIX}${sessionId}`);
    if (payloadRaw) {
      // Single-use: delete both keys after reading the payload
      await this.redis.del(
        `${QR_SESSION_PREFIX}${sessionId}`,
        `${QR_PAYLOAD_PREFIX}${sessionId}`,
      );
      const payload = JSON.parse(payloadRaw) as QrPayloadData;
      return {
        status: 'approved',
        phoneEphemeralPub: payload.phoneEphemeralPub,
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        deviceId: payload.deviceId,
        signature: payload.signature,
      };
    }

    // Check for a denied state (consumed flag set without a payload — future PAK-denied flow)
    // The 'denied' branch is forward-compatible: a future endpoint can set consumed=true
    // without writing a payload. Currently unreachable (cancelQrSession deletes the key
    // instead), but the branch is preserved here so polling clients can handle it.
    if (session.consumed) {
      return { status: 'denied' };
    }

    return { status: 'pending' };
  }

  async submitRelayPayload(
    sessionId: string,
    dto: { phoneEphemeralPub: string; ciphertext: string; iv: string; deviceId: string; signature: string },
  ): Promise<void> {
    const raw = await this.redis.get(`${QR_SESSION_PREFIX}${sessionId}`);
    if (!raw) {
      throw new NotFoundException('QR session not found or expired');
    }

    const session = JSON.parse(raw) as QrSessionData;
    if (session.consumed) {
      throw new ConflictException('QR session already consumed');
    }

    // Mark the session as consumed so a second submit is rejected
    session.consumed = true;
    // Preserve remaining TTL by getting the current TTL and re-setting
    const ttl = await this.redis.ttl(`${QR_SESSION_PREFIX}${sessionId}`);
    if (ttl > 0) {
      await this.redis.setex(`${QR_SESSION_PREFIX}${sessionId}`, ttl, JSON.stringify(session));
    } else {
      await this.redis.set(`${QR_SESSION_PREFIX}${sessionId}`, JSON.stringify(session));
    }

    // Store the relay payload for the desktop to pick up
    const payload: QrPayloadData = {
      phoneEphemeralPub: dto.phoneEphemeralPub,
      ciphertext: dto.ciphertext,
      iv: dto.iv,
      deviceId: dto.deviceId,
      signature: dto.signature,
    };
    await this.redis.setex(
      `${QR_PAYLOAD_PREFIX}${sessionId}`,
      QR_PAYLOAD_TTL_SECONDS,
      JSON.stringify(payload),
    );
  }

  async cancelQrSession(sessionId: string): Promise<void> {
    await this.redis.del(
      `${QR_SESSION_PREFIX}${sessionId}`,
      `${QR_PAYLOAD_PREFIX}${sessionId}`,
    );
  }

  async issueEnrollSession(desktopPublicKeySpki: string, challengeHex: string): Promise<EnrollSessionResponseDto> {
    if (!/^[0-9a-fA-F]{64}$/.test(challengeHex)) {
      throw new ConflictException('challengeHex must be a 64-character hex string');
    }

    const sessionId = crypto.randomUUID();
    const sessionData: EnrollSessionData = {
      desktopPublicKeySpki,
      challengeHex,
      createdAt: Date.now(),
    };

    await this.redis.setex(
      `${ENROLL_SESSION_PREFIX}${sessionId}`,
      ENROLL_TTL_SECONDS,
      JSON.stringify(sessionData),
    );

    return { sessionId, ttlSeconds: ENROLL_TTL_SECONDS };
  }

  async getEnrollStatus(sessionId: string): Promise<EnrollStatusResponseDto> {
    const raw = await this.redis.get(`${ENROLL_SESSION_PREFIX}${sessionId}`);
    if (!raw) {
      return { status: 'waiting' };
    }

    const phoneRaw = await this.redis.get(`${ENROLL_PHONE_PREFIX}${sessionId}`);
    if (phoneRaw) {
      const phoneData = JSON.parse(phoneRaw) as EnrollPhoneData;
      return { status: 'phone_ready', phoneEphemeralPub: phoneData.phoneEphemeralPub, deviceId: phoneData.deviceId };
    }

    return { status: 'waiting' };
  }

  async submitEnrollVault(sessionId: string, userId: string, dto: SubmitEnrollVaultDto): Promise<void> {
    const phoneRaw = await this.redis.get(`${ENROLL_PHONE_PREFIX}${sessionId}`);
    if (!phoneRaw) {
      throw new NotFoundException('Enrollment session not found or expired');
    }

    const phoneData = JSON.parse(phoneRaw) as EnrollPhoneData;
    if (phoneData.userId !== userId) {
      throw new ForbiddenException('Not your enrollment session');
    }

    const existing = await this.redis.get(`${ENROLL_VAULT_PREFIX}${sessionId}`);
    if (existing) {
      throw new ConflictException('Vault key already submitted');
    }

    const vaultData: EnrollVaultData = { ciphertext: dto.ciphertext, iv: dto.iv };
    await this.redis.setex(
      `${ENROLL_VAULT_PREFIX}${sessionId}`,
      ENROLL_VAULT_TTL_SECONDS,
      JSON.stringify(vaultData),
    );
  }

  async getEnrollVault(sessionId: string, userId: string): Promise<EnrollVaultStatusResponseDto> {
    const phoneRaw = await this.redis.get(`${ENROLL_PHONE_PREFIX}${sessionId}`);
    if (!phoneRaw) {
      throw new NotFoundException('Enrollment session not found or expired');
    }

    const phoneData = JSON.parse(phoneRaw) as EnrollPhoneData;
    if (phoneData.userId !== userId) {
      throw new ForbiddenException('Not your enrollment session');
    }

    const vaultRaw = await this.redis.get(`${ENROLL_VAULT_PREFIX}${sessionId}`);
    if (!vaultRaw) {
      return { status: 'waiting' };
    }

    const vaultData = JSON.parse(vaultRaw) as EnrollVaultData;
    await this.redis.del(`${ENROLL_VAULT_PREFIX}${sessionId}`);
    return { status: 'ready', ciphertext: vaultData.ciphertext, iv: vaultData.iv };
  }

  async cancelEnrollSession(sessionId: string): Promise<void> {
    await this.redis.del(
      `${ENROLL_SESSION_PREFIX}${sessionId}`,
      `${ENROLL_PHONE_PREFIX}${sessionId}`,
      `${ENROLL_VAULT_PREFIX}${sessionId}`,
    );
  }

  async enrollDevice(
    userId: string,
    dto: EnrollDeviceDto,
    ip: string,
    ua: string,
  ): Promise<DeviceVaultKey> {
    // Derive fingerprint server-side — never trust the client-supplied value.
    const fingerprint = crypto
      .createHash('sha256')
      .update(Buffer.from(dto.devicePublicKeySpki, 'base64'))
      .digest('hex');

    const existing = await this.em.findOne(DeviceVaultKey, { publicKeyFingerprint: fingerprint });
    if (existing) {
      throw new ConflictException('A device with this public key fingerprint is already registered');
    }

    const user = this.em.getReference(User, userId);
    const device = this.em.create(DeviceVaultKey, {
      user,
      publicKeyFingerprint: fingerprint,
      devicePublicKey: dto.devicePublicKeySpki,
      enrollmentMethod: dto.enrollmentMethod as PakEnrollmentMethod,
      deviceName: dto.deviceName,
      platform: dto.platform as PakPlatform,
      enrolledAt: new Date(),
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
      revokedReason: null,
      reCipherCompleted: false,
    } as never);

    this.em.persist(device);
    this.auditService.persistLog(userId, AuditAction.PAK_DEVICE_ENROLLED, ip, ua, {
      deviceName: dto.deviceName,
      platform: dto.platform,
      enrollmentMethod: dto.enrollmentMethod,
    });
    await this.em.flush();

    if (dto.enrollmentSessionId) {
      const phoneData: EnrollPhoneData = {
        phoneEphemeralPub: dto.enrollmentEphemeralPub,
        deviceId: device.id,
        userId,
      };
      await this.redis.setex(
        `${ENROLL_PHONE_PREFIX}${dto.enrollmentSessionId}`,
        ENROLL_TTL_SECONDS,
        JSON.stringify(phoneData),
      );
    }

    return device;
  }

  async listDevices(userId: string): Promise<DeviceVaultKey[]> {
    return this.em.find(
      DeviceVaultKey,
      { user: userId, revokedAt: null },
      { orderBy: { enrolledAt: 'ASC' } },
    );
  }

  async revokeDevice(
    userId: string,
    deviceId: string,
    reason: 'safe' | 'compromised',
    ip: string,
    ua: string,
  ): Promise<void> {
    const device = await this.em.findOne(DeviceVaultKey, { id: deviceId, user: userId });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    if (device.revokedAt !== null) {
      throw new ConflictException('Device is already revoked');
    }

    device.revokedAt = new Date();
    device.revokedReason = reason as PakRevocationReason;

    this.auditService.persistLog(userId, AuditAction.PAK_DEVICE_REVOKED, ip, ua, {
      deviceName: device.deviceName,
      reason,
    });
    await this.em.flush();
  }

  async renameDevice(
    userId: string,
    deviceId: string,
    dto: RenameDeviceDto,
  ): Promise<DeviceVaultKey> {
    const device = await this.em.findOne(DeviceVaultKey, { id: deviceId, user: userId });
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    device.deviceName = dto.deviceName;
    await this.em.flush();

    return device;
  }

  toDeviceResponse(device: DeviceVaultKey) {
    return toDeviceResponse(device);
  }
}
