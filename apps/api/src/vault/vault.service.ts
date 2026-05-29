import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { VaultEntry, EnvironmentTag } from '../entities/vault-entry.entity';
import { VaultEntryVersion } from '../entities/vault-entry-version.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../entities/audit-log.entity';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto';
import { ListVaultEntriesQueryDto } from './dto/list-vault-entries-query.dto';
import { User } from '../entities/user.entity';

const MAX_VERSIONS = 10;
const DEFAULT_LIMIT = 50;

function encodeCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString('base64url');
}

function decodeCursor(cursor: string): Date {
  return new Date(Buffer.from(cursor, 'base64url').toString('utf-8'));
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable()
export class VaultService {
  constructor(
    private readonly em: EntityManager,
    private readonly auditService: AuditService,
  ) {}

  async list(
    userId: string,
    query: ListVaultEntriesQueryDto,
  ): Promise<PaginatedResult<VaultEntry>> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const filter: Record<string, unknown> = { user: { id: userId } };
    if (query.type) filter['entryType'] = query.type;
    if (cursor) filter['createdAt'] = { $gt: cursor };

    const entries = await this.em.find(VaultEntry, filter as never, {
      orderBy: { createdAt: 'ASC' },
      limit: limit + 1,
    });

    const hasMore = entries.length > limit;
    const data = hasMore ? entries.slice(0, limit) : entries;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1].createdAt) : null;

    return { data, nextCursor, hasMore };
  }

  // Ownership enforced by querying both id and user.id — returns 404 for both
  // missing entries and entries belonging to another user (no information leak).
  async findOne(userId: string, entryId: string): Promise<VaultEntry> {
    const entry = await this.em.findOne(VaultEntry, { id: entryId, user: { id: userId } });
    if (!entry) throw new NotFoundException('Entry not found');
    return entry;
  }

  async findOneAndAudit(
    userId: string,
    entryId: string,
    ip: string,
    userAgent: string,
  ): Promise<VaultEntry> {
    const entry = await this.findOne(userId, entryId);
    await this.auditService.log(userId, AuditAction.VAULT_READ, ip, userAgent, { entryId });
    return entry;
  }

  async create(
    userId: string,
    dto: CreateVaultEntryDto,
    ip: string,
    userAgent: string,
  ): Promise<VaultEntry> {
    const entry = this.em.create(VaultEntry, {
      user: this.em.getReference(User, userId),
      entryType: dto.entryType,
      encryptedData: dto.encryptedData,
      iv: dto.iv,
      authTag: dto.authTag,
      labelHash: dto.labelHash,
      encryptedMetadata: dto.encryptedMetadata ?? null,
      metadataIv: dto.metadataIv ?? null,
      environmentTag: dto.environmentTag ?? null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    this.em.persist(entry);
    await this.em.flush();

    await this.auditService.log(userId, AuditAction.VAULT_CREATE, ip, userAgent, {
      entryId: entry.id,
      entryType: dto.entryType,
    });

    return entry;
  }

  async update(
    userId: string,
    entryId: string,
    dto: UpdateVaultEntryDto,
    ip: string,
    userAgent: string,
  ): Promise<VaultEntry> {
    const entry = await this.findOne(userId, entryId);

    const snapshot = this.em.create(VaultEntryVersion, {
      entry,
      encryptedData: entry.encryptedData,
      iv: entry.iv,
      authTag: entry.authTag,
      version: entry.version,
      changeNote: dto.changeNote ?? null,
      createdAt: new Date(),
    } as never);
    this.em.persist(snapshot);

    if (dto.encryptedData !== undefined) entry.encryptedData = dto.encryptedData;
    if (dto.iv !== undefined) entry.iv = dto.iv;
    if (dto.authTag !== undefined) entry.authTag = dto.authTag;
    if (dto.labelHash !== undefined) entry.labelHash = dto.labelHash;
    if (dto.encryptedMetadata !== undefined) entry.encryptedMetadata = dto.encryptedMetadata;
    if (dto.metadataIv !== undefined) entry.metadataIv = dto.metadataIv;
    if ('environmentTag' in dto) entry.environmentTag = (dto.environmentTag as EnvironmentTag | null | undefined) ?? null;
    entry.version += 1;

    await this.em.flush();

    const versionCount = await this.em.count(VaultEntryVersion, { entry });
    if (versionCount > MAX_VERSIONS) {
      const excess = await this.em.find(VaultEntryVersion, { entry }, {
        orderBy: { version: 'ASC' },
        limit: versionCount - MAX_VERSIONS,
      });
      for (const v of excess) this.em.remove(v);
      await this.em.flush();
    }

    await this.auditService.log(userId, AuditAction.VAULT_UPDATE, ip, userAgent, { entryId });

    return entry;
  }

  async remove(
    userId: string,
    entryId: string,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    const entry = await this.findOne(userId, entryId);
    this.em.remove(entry);
    await this.em.flush();
    await this.auditService.log(userId, AuditAction.VAULT_DELETE, ip, userAgent, { entryId });
  }

  async listVersions(userId: string, entryId: string): Promise<VaultEntryVersion[]> {
    await this.findOne(userId, entryId);
    return this.em.find(VaultEntryVersion, { entry: { id: entryId } }, {
      orderBy: { version: 'DESC' },
    });
  }

  async restoreVersion(
    userId: string,
    entryId: string,
    versionId: string,
    ip: string,
    userAgent: string,
  ): Promise<VaultEntry> {
    const entry = await this.findOne(userId, entryId);
    const ver = await this.em.findOne(VaultEntryVersion, {
      id: versionId,
      entry: { id: entryId },
    });
    if (!ver) throw new NotFoundException('Version not found');

    const snapshot = this.em.create(VaultEntryVersion, {
      entry,
      encryptedData: entry.encryptedData,
      iv: entry.iv,
      authTag: entry.authTag,
      version: entry.version,
      changeNote: `Restored to version ${ver.version}`,
      createdAt: new Date(),
    } as never);
    this.em.persist(snapshot);

    entry.encryptedData = ver.encryptedData;
    entry.iv = ver.iv;
    entry.authTag = ver.authTag;
    entry.version += 1;

    await this.em.flush();

    await this.auditService.log(userId, AuditAction.VAULT_VERSION_RESTORE, ip, userAgent, {
      entryId,
      restoredVersionId: versionId,
      restoredVersion: ver.version,
    });

    return entry;
  }
}
