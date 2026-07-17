import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

interface UploadStorageFileHandle {
  close(): Promise<void>;
}

export interface UploadStorageFs {
  mkdir(directory: string, options: { recursive: true }): Promise<unknown>;
  open(file: string, flags: 'wx', mode: number): Promise<UploadStorageFileHandle>;
  unlink(file: string): Promise<void>;
}

const defaultFs: UploadStorageFs = { mkdir, open, unlink };

function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown filesystem error';
  const code = (error as NodeJS.ErrnoException).code;
  return code ? `${code}: ${error.message}` : error.message;
}

/**
 * Prove that upload storage supports the operations required by image upload.
 * The short-lived probe is created inside the workspace root, matching the
 * directory where current product-image uploads write their files.
 */
export async function verifyUploadStorageWritable(
  configuredUploadDir: string,
  filesystem: UploadStorageFs = defaultFs,
): Promise<string> {
  const uploadDir = path.resolve(process.cwd(), configuredUploadDir);
  const workspacesDir = path.join(uploadDir, 'workspaces');
  const probePath = path.join(workspacesDir, `.marketdesk-write-probe-${randomUUID()}`);
  let probe: UploadStorageFileHandle | undefined;
  let probeCreated = false;

  try {
    await filesystem.mkdir(workspacesDir, { recursive: true });
    probe = await filesystem.open(probePath, 'wx', 0o600);
    probeCreated = true;
    await probe.close();
    probe = undefined;
    await filesystem.unlink(probePath);
    probeCreated = false;
    return uploadDir;
  } catch (error) {
    if (probe) await probe.close().catch(() => undefined);
    if (probeCreated) {
      await filesystem.unlink(probePath).catch(() => undefined);
    }
    const startupError = new Error(
      `Upload storage is not writable at ${uploadDir}. ` +
        `Check directory ownership for the application user (UID 1001): ${errorSummary(error)}`,
    );
    (startupError as Error & { cause?: unknown }).cause = error;
    throw startupError;
  }
}