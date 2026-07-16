import type {
  IProductImageStorage,
  StoredProductImage,
} from '../ports/IProductImageStorage';
import { ProductImageUploadService } from '../services/ProductImageUploadService';

class RecordingStorage implements IProductImageStorage {
  stored: Array<{
    workspaceId: string;
    bytes: Buffer;
    extension: 'jpg' | 'png' | 'webp';
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> = [];
  deleted: Array<{ workspaceId: string; imageId: string }> = [];

  async store(input: (typeof this.stored)[number]): Promise<StoredProductImage> {
    this.stored.push({ ...input, bytes: Buffer.from(input.bytes) });
    return {
      id: '123e4567-e89b-42d3-a456-426614174000',
      url: '/uploads/workspaces/ws/products/123e4567-e89b-42d3-a456-426614174000.jpg',
      mediaType: input.mediaType,
      size: input.bytes.length,
    };
  }

  async delete(workspaceId: string, imageId: string): Promise<boolean> {
    this.deleted.push({ workspaceId, imageId });
    return true;
  }
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBPVP8 ', 'binary');

describe('ProductImageUploadService', () => {
  it.each([
    ['image/jpeg' as const, jpeg, 'jpg' as const],
    ['image/png' as const, png, 'png' as const],
    ['image/webp' as const, webp, 'webp' as const],
  ])('stores a validated %s image in the authenticated workspace', async (mediaType, bytes, extension) => {
    const storage = new RecordingStorage();
    const service = new ProductImageUploadService(storage, 1024);

    const result = await service.upload({ workspaceId: 'ws-1', mediaType, bytes });

    expect(result.url).toMatch(/^\/uploads\//);
    expect(storage.stored).toEqual([
      { workspaceId: 'ws-1', mediaType, extension, bytes },
    ]);
  });

  it('rejects an empty image', async () => {
    const service = new ProductImageUploadService(new RecordingStorage(), 1024);

    await expect(
      service.upload({ workspaceId: 'ws-1', mediaType: 'image/jpeg', bytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a MIME type that does not match the decoded signature', async () => {
    const service = new ProductImageUploadService(new RecordingStorage(), 1024);

    await expect(
      service.upload({ workspaceId: 'ws-1', mediaType: 'image/png', bytes: jpeg }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects unsupported and oversized image data', async () => {
    const service = new ProductImageUploadService(new RecordingStorage(), 4);

    await expect(
      service.upload({ workspaceId: 'ws-1', mediaType: 'image/gif', bytes: Buffer.from('GIF89a') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.upload({ workspaceId: 'ws-1', mediaType: 'image/jpeg', bytes: jpeg }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('deletes only through the authenticated workspace scope', async () => {
    const storage = new RecordingStorage();
    const service = new ProductImageUploadService(storage, 1024);

    await expect(
      service.delete('ws-1', '123e4567-e89b-42d3-a456-426614174000'),
    ).resolves.toBe(true);
    expect(storage.deleted).toEqual([
      { workspaceId: 'ws-1', imageId: '123e4567-e89b-42d3-a456-426614174000' },
    ]);
  });

  it('rejects non-UUID image ids before touching storage', async () => {
    const storage = new RecordingStorage();
    const service = new ProductImageUploadService(storage, 1024);

    await expect(service.delete('ws-1', '../../other-workspace/image')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(storage.deleted).toEqual([]);
  });
});
