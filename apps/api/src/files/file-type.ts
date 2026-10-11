import { createHash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import type { FileMimeType } from '@biznexa/types';

/** Leading bytes ("magic numbers") for each type in FILE_TYPES. `null` = any byte. */
const SIGNATURES: Record<FileMimeType, (number | null)[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]], // RIFF....WEBP
};

/** Bytes needed to tell every supported type apart. */
export const SNIFF_BYTES = 12;

/** The type the content actually is, judged by its first bytes; null when it is none we accept. */
export function detectFileType(head: Uint8Array): FileMimeType | null {
  for (const [type, signatures] of Object.entries(SIGNATURES) as [FileMimeType, (number | null)[][]][]) {
    if (signatures.some((sig) => sig.length <= head.length && sig.every((b, i) => b === null || head[i] === b))) return type;
  }
  return null;
}

export class FileContentMismatchError extends Error {}

/**
 * Pass-through stream that checks the file's first bytes against the expected type before any
 * byte is written, and records size and SHA-256 on the way.
 */
export class FileInspector extends Transform {
  size = 0;
  /** Set once the whole file has passed through. */
  sha256 = '';
  private head: Buffer[] = [];
  private headLength = 0;
  private checked = false;
  private readonly hash = createHash('sha256');

  constructor(private readonly expected: FileMimeType, private readonly expectedLabel: string) {
    super();
  }

  private check(): Error | null {
    this.checked = true;
    const head = Buffer.concat(this.head);
    this.head = [];
    if (detectFileType(head) !== this.expected) {
      return new FileContentMismatchError(`This file is not a real ${this.expectedLabel} file. Please upload the original document.`);
    }
    this.push(head);
    return null;
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.size += chunk.length;
    this.hash.update(chunk);
    if (this.checked) return cb(null, chunk);
    this.head.push(chunk);
    this.headLength += chunk.length;
    cb(this.headLength >= SNIFF_BYTES ? this.check() : null);
  }

  _flush(cb: TransformCallback) {
    const err = this.checked ? null : this.check();
    if (!err) this.sha256 = this.hash.digest('hex');
    cb(err);
  }
}
