import { NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Private file storage (D17). Callers only see opaque keys; drivers decide where bytes live,
 * so an S3 driver can replace the local disk without touching callers.
 */
export abstract class StorageService {
  /** Store a stream under `key`. On failure nothing is left behind and the error is rethrown. */
  abstract write(key: string, data: Readable): Promise<void>;
  /** Open a stored file. Throws NotFoundException when it is missing. */
  abstract read(key: string): Promise<{ stream: Readable; size: number }>;
  /** Delete a stored file. Missing files are ignored. */
  abstract remove(key: string): Promise<void>;
}

/** `ab/<32 hex>` — random, sharded by the first byte so no folder grows huge. */
export function newFileKey(): string {
  const hex = randomBytes(16).toString('hex');
  return `${hex.slice(0, 2)}/${hex}`;
}

const KEY_FORMAT = /^[0-9a-f]{2}\/[0-9a-f]{32}$/;

/**
 * Files under a root folder: UPLOAD_DIR (private; outside any publicly served folder, backed up) or
 * MEDIA_DIR (public website images, M9.4), each with its own instance and key format.
 */
export class LocalDiskStorage extends StorageService {
  private readonly root: string;

  constructor(root: string, private readonly keyFormat: RegExp = KEY_FORMAT) {
    super();
    this.root = resolve(root);
  }

  /** Only keys we generate are accepted, so a key can never point outside the root. */
  private pathFor(key: string) {
    if (!this.keyFormat.test(key)) throw new Error(`Invalid file key: ${key}`);
    return join(this.root, key);
  }

  async write(key: string, data: Readable) {
    const path = this.pathFor(key);
    const partial = `${path}.part`;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      // flags 'wx': never overwrite an existing file.
      await pipeline(data, createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
      await rename(partial, path);
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }
  }

  async read(key: string) {
    const path = this.pathFor(key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('File not found');
    return { stream: createReadStream(path), size: info.size };
  }

  async remove(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}
