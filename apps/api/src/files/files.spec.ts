import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { detectFileType, FileContentMismatchError, FileInspector } from './file-type';
import { cleanFileName, contentDisposition } from './files.service';
import { LocalDiskStorage, newFileKey } from './storage.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');

describe('detectFileType', () => {
  it('recognises each supported type by its first bytes', () => {
    expect(detectFileType(PDF)).toBe('application/pdf');
    expect(detectFileType(PNG)).toBe('image/png');
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectFileType(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp');
  });

  it('rejects other content and files too short to tell', () => {
    expect(detectFileType(Buffer.from('MZ\x90\x00'))).toBeNull(); // Windows executable
    expect(detectFileType(Buffer.from('<html><script>'))).toBeNull();
    expect(detectFileType(Buffer.from('%PD'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe('FileInspector', () => {
  const run = (expected: 'image/png' | 'application/pdf', chunks: Buffer[]) => {
    const inspector = new FileInspector(expected, 'X');
    const out: Buffer[] = [];
    return new Promise<{ data: Buffer; inspector: FileInspector }>((resolve, reject) => {
      Readable.from(chunks)
        .pipe(inspector)
        .on('data', (c: Buffer) => out.push(c))
        .on('end', () => resolve({ data: Buffer.concat(out), inspector }))
        .on('error', reject);
    });
  };

  it('passes matching content through unchanged, even when the header arrives in tiny chunks', async () => {
    const file = Buffer.concat([PNG, Buffer.alloc(5000, 7)]);
    const chunks = [file.subarray(0, 3), file.subarray(3, 5), file.subarray(5)];
    const { data, inspector } = await run('image/png', chunks);
    expect(data.equals(file)).toBe(true);
    expect(inspector.size).toBe(file.length);
    expect(inspector.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails on content that does not match the expected type, including tiny files', async () => {
    await expect(run('application/pdf', [PNG])).rejects.toBeInstanceOf(FileContentMismatchError);
    await expect(run('application/pdf', [Buffer.from('%P')])).rejects.toBeInstanceOf(FileContentMismatchError);
  });
});

describe('LocalDiskStorage', () => {
  let root: string;
  let storage: LocalDiskStorage;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bn-storage-'));
    storage = new LocalDiskStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('writes, reads and removes by key', async () => {
    const key = newFileKey();
    await storage.write(key, Readable.from([PDF]));
    expect(await readFile(join(root, key))).toEqual(PDF);
    const { stream, size } = await storage.read(key);
    stream.destroy();
    expect(size).toBe(PDF.length);
    await storage.remove(key);
    await expect(storage.read(key)).rejects.toThrow('File not found');
  });

  it('leaves nothing behind when the stream fails', async () => {
    const key = newFileKey();
    const failing = new Readable({
      read() {
        this.push(PDF);
        this.destroy(new Error('client went away'));
      },
    });
    await expect(storage.write(key, failing)).rejects.toThrow('client went away');
    expect(await readdir(join(root, key.slice(0, 2)))).toEqual([]);
  });

  it('refuses keys it did not generate (no path traversal)', async () => {
    await expect(storage.read('../../etc/passwd')).rejects.toThrow('Invalid file key');
    await expect(storage.write('ab/../../x', Readable.from([PDF]))).rejects.toThrow('Invalid file key');
  });
});

describe('file names', () => {
  it('cleans names for headers', () => {
    expect(cleanFileName(String.raw`C:\Users\me\PAN card.pdf`)).toBe('PAN card.pdf');
    expect(cleanFileName('a"b\r\nc.pdf')).toBe('abc.pdf');
    expect(cleanFileName('')).toBe('file');
    expect(cleanFileName(`${'x'.repeat(300)}.pdf`)).toHaveLength(150);
    expect(cleanFileName(`${'x'.repeat(300)}.pdf`).endsWith('.pdf')).toBe(true);
  });

  it('builds a Content-Disposition with ASCII fallback and UTF-8 name', () => {
    expect(contentDisposition('attachment', 'आधार card.pdf')).toBe(
      "attachment; filename=\"____ card.pdf\"; filename*=UTF-8''%E0%A4%86%E0%A4%A7%E0%A4%BE%E0%A4%B0%20card.pdf",
    );
  });
});
