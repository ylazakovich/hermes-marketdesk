import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  IProductImageStorage,
  ProductImageExtension,
  StoreProductImageInput,
  StoredProductImage,
} from '../../application/ports/IProductImageStorage';
import { ConfigurationError, ValidationError } from '../../domain/shared/DomainError';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSIONS: readonly ProductImageExtension[] = ['jpg', 'png', 'webp'];

function workspaceKey(workspaceId: string): string {
  return createHash('sha256').update(workspaceId).digest('hex').slice(0, 24);
}

export class FilesystemProductImageStorage implements IProductImageStorage {
  constructor(
    private readonly uploadDir: string,
    private readonly generateId: () => string = randomUUID,
  ) {}

  async store(input: StoreProductImageInput): Promise<StoredProductImage> {
    const id = this.generateId();
    if (!UUID_PATTERN.test(id)) {
      throw new ConfigurationError('Product image id generator returned an invalid UUID');
    }

    const workspace = workspaceKey(input.workspaceId);
    const relativePath = path.join('workspaces', workspace, 'products', `${id}.${input.extension}`);
    const absolutePath = path.resolve(this.uploadDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.bytes, { flag: 'wx' });

    return {
      id,
      url: `/uploads/${relativePath.split(path.sep).join('/')}`,
      mediaType: input.mediaType,
      size: input.bytes.length,
    };
  }

  async delete(workspaceId: string, imageId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(imageId)) throw new ValidationError('Invalid image id');
    const directory = path.resolve(this.uploadDir, 'workspaces', workspaceKey(workspaceId), 'products');
    let deleted = false;

    await Promise.all(
      EXTENSIONS.map(async (extension) => {
        try {
          await unlink(path.join(directory, `${imageId}.${extension}`));
          deleted = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }),
    );

    return deleted;
  }
}
