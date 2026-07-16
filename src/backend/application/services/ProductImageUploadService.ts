import { ValidationError } from '../../domain/shared/DomainError';
import type {
  IProductImageStorage,
  ProductImageExtension,
  ProductImageMediaType,
  StoredProductImage,
} from '../ports/IProductImageStorage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasPrefix(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function detectedImage(bytes: Buffer): {
  mediaType: ProductImageMediaType;
  extension: ProductImageExtension;
} | null {
  if (bytes.length >= 3 && hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { mediaType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 8 &&
    hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return { mediaType: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mediaType: 'image/webp', extension: 'webp' };
  }
  return null;
}

export class ProductImageUploadService {
  constructor(
    private readonly storage: IProductImageStorage,
    private readonly maxFileSize: number,
  ) {}

  async upload(input: {
    workspaceId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<StoredProductImage> {
    if (input.bytes.length === 0) throw new ValidationError('Image body is required');
    if (input.bytes.length > this.maxFileSize) {
      throw new ValidationError(`Image exceeds the ${this.maxFileSize} byte limit`);
    }

    const detected = detectedImage(input.bytes);
    if (!detected) throw new ValidationError('Unsupported image signature');
    if (input.mediaType !== detected.mediaType) {
      throw new ValidationError('Content-Type does not match the image signature');
    }

    return this.storage.store({
      workspaceId: input.workspaceId,
      bytes: Buffer.from(input.bytes),
      extension: detected.extension,
      mediaType: detected.mediaType,
    });
  }

  async delete(workspaceId: string, imageId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(imageId)) throw new ValidationError('Invalid image id');
    return this.storage.delete(workspaceId, imageId);
  }
}
