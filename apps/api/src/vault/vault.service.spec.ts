import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VaultService } from './vault.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../entities/audit-log.entity';
import { EntityManager } from '@mikro-orm/core';
import { EntryType, EnvironmentTag } from '../entities/vault-entry.entity';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto';

const mockEntry = (overrides = {}) => ({
  id: 'entry-1',
  user: { id: 'user-1' },
  entryType: EntryType.LOGIN,
  encryptedData: 'ciphertext-abc',
  iv: 'iv-abc',
  authTag: 'tag-abc',
  labelHash: 'a'.repeat(64),
  encryptedMetadata: null,
  metadataIv: null,
  environmentTag: null,
  version: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('VaultService', () => {
  let service: VaultService;
  let mockEm: {
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    persist: jest.Mock;
    flush: jest.Mock;
    remove: jest.Mock;
    getReference: jest.Mock;
  };
  let mockAudit: { log: jest.Mock; persistLog: jest.Mock };

  beforeEach(async () => {
    mockEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((_, data) => ({ ...data })),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
      getReference: jest.fn().mockImplementation((_, id) => ({ id })),
    };
    mockAudit = {
      log: jest.fn().mockResolvedValue(undefined),
      persistLog: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultService,
        { provide: EntityManager, useValue: mockEm },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<VaultService>(VaultService);
  });

  describe('findOne', () => {
    it('returns entry when found for owner', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);

      const result = await service.findOne('user-1', 'entry-1');

      expect(mockEm.findOne).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'entry-1', user: { id: 'user-1' } },
      );
      expect(result).toBe(entry);
    });

    it('throws NotFoundException when entry not found', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for entry owned by another user (no info leak)', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.findOne('user-2', 'entry-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns paginated result without cursor', async () => {
      const entries = [mockEntry({ id: 'e1' }), mockEntry({ id: 'e2' })];
      mockEm.find.mockResolvedValue(entries);

      const result = await service.list('user-1', { limit: 50 });

      expect(result.data).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('sets hasMore and nextCursor when more results exist', async () => {
      const entries = Array.from({ length: 51 }, (_, i) =>
        mockEntry({ id: `e${i}`, createdAt: new Date(Date.now() + i * 1000) }),
      );
      mockEm.find.mockResolvedValue(entries);

      const result = await service.list('user-1', { limit: 50 });

      expect(result.data).toHaveLength(50);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeTruthy();
    });

    it('filters by entry type when provided', async () => {
      mockEm.find.mockResolvedValue([]);

      await service.list('user-1', { type: EntryType.ENV_FILE });

      expect(mockEm.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ entryType: EntryType.ENV_FILE }),
        expect.anything(),
      );
    });

    it('adds cursor predicate when cursor provided', async () => {
      const cursorDate = new Date('2026-01-01T00:00:00Z');
      const cursor = Buffer.from(cursorDate.toISOString()).toString('base64url');
      mockEm.find.mockResolvedValue([]);

      await service.list('user-1', { cursor });

      expect(mockEm.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ createdAt: { $gt: expect.any(Date) } }),
        expect.anything(),
      );
    });
  });

  describe('create', () => {
    it('persists entry, flushes, and logs audit', async () => {
      const dto: CreateVaultEntryDto = {
        entryType: EntryType.LOGIN,
        encryptedData: 'cipher',
        iv: 'nonce',
        authTag: 'tag',
        labelHash: 'h'.repeat(64),
      };

      const created = mockEntry({ id: 'new-entry' });
      mockEm.create.mockReturnValueOnce(created);

      const result = await service.create('user-1', dto, '1.1.1.1', 'TestAgent');

      expect(mockEm.persist).toHaveBeenCalled();
      expect(mockEm.flush).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        'user-1',
        AuditAction.VAULT_CREATE,
        '1.1.1.1',
        'TestAgent',
        expect.objectContaining({ entryId: 'new-entry' }),
      );
      expect(result).toBe(created);
    });

    it('sets environmentTag for ENV_FILE entries', async () => {
      const dto: CreateVaultEntryDto = {
        entryType: EntryType.ENV_FILE,
        encryptedData: 'cipher',
        iv: 'nonce',
        authTag: 'tag',
        labelHash: 'h'.repeat(64),
        environmentTag: EnvironmentTag.PRODUCTION,
      };

      mockEm.create.mockReturnValueOnce(mockEntry());
      await service.create('user-1', dto, '1.1.1.1', 'UA');

      expect(mockEm.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ environmentTag: EnvironmentTag.PRODUCTION }),
      );
    });
  });

  describe('update', () => {
    it('snapshots current version before update', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);
      mockEm.count.mockResolvedValue(1);

      const dto: UpdateVaultEntryDto = { encryptedData: 'new-cipher', iv: 'new-iv', authTag: 'new-tag' };
      await service.update('user-1', 'entry-1', dto, '1.1.1.1', 'UA');

      expect(mockEm.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          encryptedData: 'ciphertext-abc',
          iv: 'iv-abc',
          authTag: 'tag-abc',
          version: 1,
        }),
      );
    });

    it('increments version counter on entry', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);
      mockEm.count.mockResolvedValue(1);

      await service.update('user-1', 'entry-1', { encryptedData: 'new' }, '1.1.1.1', 'UA');

      expect(entry.version).toBe(2);
    });

    it('prunes oldest versions when count exceeds MAX_VERSIONS (10)', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);
      mockEm.count.mockResolvedValue(11);
      const oldVersions = [{ id: 'v-old-1' }];
      mockEm.find.mockResolvedValue(oldVersions);

      await service.update('user-1', 'entry-1', {}, '1.1.1.1', 'UA');

      expect(mockEm.remove).toHaveBeenCalledWith(oldVersions[0]);
    });

    it('does not prune when version count within limit', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);
      mockEm.count.mockResolvedValue(5);

      await service.update('user-1', 'entry-1', {}, '1.1.1.1', 'UA');

      expect(mockEm.remove).not.toHaveBeenCalled();
    });

    it('logs VAULT_UPDATE audit action', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);
      mockEm.count.mockResolvedValue(1);

      await service.update('user-1', 'entry-1', {}, '1.1.1.1', 'UA');

      expect(mockAudit.log).toHaveBeenCalledWith(
        'user-1',
        AuditAction.VAULT_UPDATE,
        '1.1.1.1',
        'UA',
        expect.objectContaining({ entryId: 'entry-1' }),
      );
    });
  });

  describe('remove', () => {
    it('removes entry and logs audit', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);

      await service.remove('user-1', 'entry-1', '1.1.1.1', 'UA');

      expect(mockEm.remove).toHaveBeenCalledWith(entry);
      expect(mockEm.flush).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        'user-1',
        AuditAction.VAULT_DELETE,
        '1.1.1.1',
        'UA',
        expect.objectContaining({ entryId: 'entry-1' }),
      );
    });

    it('throws NotFoundException when entry not found', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.remove('user-1', 'missing', '1.1.1.1', 'UA')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listVersions', () => {
    it('returns versions sorted descending', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);
      const versions = [{ id: 'v2', version: 2 }, { id: 'v1', version: 1 }];
      mockEm.find.mockResolvedValue(versions);

      const result = await service.listVersions('user-1', 'entry-1');

      expect(result).toBe(versions);
      expect(mockEm.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ entry: { id: 'entry-1' } }),
        expect.objectContaining({ orderBy: { version: 'DESC' } }),
      );
    });

    it('throws NotFoundException when entry not owned by user', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.listVersions('user-2', 'entry-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restoreVersion', () => {
    it('applies version data to entry and increments version counter', async () => {
      const entry = mockEntry();
      const ver = { id: 'v-1', version: 1, encryptedData: 'old-cipher', iv: 'old-iv', authTag: 'old-tag' };
      mockEm.findOne
        .mockResolvedValueOnce(entry)
        .mockResolvedValueOnce(ver);
      mockEm.create.mockImplementation((_, data) => ({ ...data }));

      await service.restoreVersion('user-1', 'entry-1', 'v-1', '1.1.1.1', 'UA');

      expect(entry.encryptedData).toBe('old-cipher');
      expect(entry.iv).toBe('old-iv');
      expect(entry.authTag).toBe('old-tag');
      expect(entry.version).toBe(2);
    });

    it('throws NotFoundException when version not found or belongs to other entry', async () => {
      const entry = mockEntry();
      mockEm.findOne
        .mockResolvedValueOnce(entry)
        .mockResolvedValueOnce(null);

      await expect(
        service.restoreVersion('user-1', 'entry-1', 'v-missing', '1.1.1.1', 'UA'),
      ).rejects.toThrow(NotFoundException);
    });

    it('logs VAULT_VERSION_RESTORE audit action', async () => {
      const entry = mockEntry();
      const ver = { id: 'v-1', version: 1, encryptedData: 'old', iv: 'iv', authTag: 'tag' };
      mockEm.findOne
        .mockResolvedValueOnce(entry)
        .mockResolvedValueOnce(ver);
      mockEm.create.mockImplementation((_, data) => ({ ...data }));

      await service.restoreVersion('user-1', 'entry-1', 'v-1', '1.1.1.1', 'UA');

      expect(mockAudit.log).toHaveBeenCalledWith(
        'user-1',
        AuditAction.VAULT_VERSION_RESTORE,
        '1.1.1.1',
        'UA',
        expect.objectContaining({
          entryId: 'entry-1',
          restoredVersionId: 'v-1',
          restoredVersion: 1,
        }),
      );
    });
  });

  describe('findOneAndAudit', () => {
    it('returns entry and logs VAULT_READ', async () => {
      const entry = mockEntry();
      mockEm.findOne.mockResolvedValue(entry);

      const result = await service.findOneAndAudit('user-1', 'entry-1', '1.1.1.1', 'UA');

      expect(result).toBe(entry);
      expect(mockAudit.log).toHaveBeenCalledWith(
        'user-1',
        AuditAction.VAULT_READ,
        '1.1.1.1',
        'UA',
        { entryId: 'entry-1' },
      );
    });
  });
});
