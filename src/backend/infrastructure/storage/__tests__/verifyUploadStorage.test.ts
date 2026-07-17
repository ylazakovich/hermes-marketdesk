import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type UploadStorageFs,
  verifyUploadStorageWritable,
} from '../verifyUploadStorage';

describe('verifyUploadStorageWritable', () => {
  let uploadDir: string;

  beforeEach(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'marketdesk-storage-startup-'));
  });

  afterEach(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('creates the workspace root, proves write/delete, and preserves legacy uploads', async () => {
    const legacyFile = path.join(uploadDir, 'legacy', 'existing.jpg');
    await mkdir(path.dirname(legacyFile), { recursive: true });
    await writeFile(legacyFile, 'existing upload');

    await expect(verifyUploadStorageWritable(uploadDir)).resolves.toBe(path.resolve(uploadDir));

    await expect(access(path.join(uploadDir, 'workspaces'))).resolves.toBeUndefined();
    await expect(readFile(legacyFile, 'utf8')).resolves.toBe('existing upload');
  });

  it('fails when the workspace directory exists but denies the write probe', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const filesystem: UploadStorageFs = {
      mkdir: async (directory, options) => mkdir(directory, options),
      open: async (file) => {
        expect(path.dirname(file)).toBe(path.join(uploadDir, 'workspaces'));
        throw denied;
      },
      unlink: async () => undefined,
    };

    await expect(verifyUploadStorageWritable(uploadDir, filesystem)).rejects.toThrow(
      new RegExp(`Upload storage is not writable at ${uploadDir}.*UID 1001.*EACCES`),
    );
  });

  it('does not unlink a pre-existing path when exclusive probe creation fails', async () => {
    const collision = Object.assign(new Error('file exists'), { code: 'EEXIST' });
    const unlink = jest.fn(async () => undefined);
    const filesystem: UploadStorageFs = {
      mkdir: async (directory, options) => mkdir(directory, options),
      open: async () => {
        throw collision;
      },
      unlink,
    };

    await expect(verifyUploadStorageWritable(uploadDir, filesystem)).rejects.toThrow('EEXIST');
    expect(unlink).not.toHaveBeenCalled();
  });
});