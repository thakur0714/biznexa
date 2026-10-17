/**
 * Uploads, virus scans and signed downloads against a real database (seeded), Redis (scan jobs, stub
 * scanner) and a throwaway UPLOAD_DIR (see setup-env.js). Each run uses unique users so it can be repeated.
 */
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { storedFileSchema, type DomainEvent } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { signedPath } from '../src/files/files.service';
import { env } from '../src/config/env';
import { EventBus } from '../src/events/event-bus';
import { EICAR } from '../src/files/virus-scanner';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string; // uploader
let bob: string; // another customer
let admin: string;
let pdfOnly: string; // requirement id: PDF only, 1 MB

const run = randomUUID();
const mobileRun = String(randomInt(1_000_000, 10_000_000));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]);
const MB = 1024 * 1024;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: 'Files Test', mobile: `8${mobileRun}${String(n).padStart(2, '0')}`, email: `e2e-files-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return res.body.accessToken as string;
}

/** Every file under UPLOAD_DIR, including leftover `.part` files. */
async function storedOnDisk(): Promise<string[]> {
  const root = env().UPLOAD_DIR;
  if (!existsSync(root)) return [];
  return (await readdir(root, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name));
}

/** This suite's users: other suites may add files at the same time. */
const ownUsers = { email: { startsWith: `e2e-files-${run}` } };

const upload = (token: string, name: string, data: Buffer, query = '') =>
  http.post(`/api/files${query}`).set('authorization', `Bearer ${token}`).attach('file', data, name);

const scanResults = new Map<string, string>();
const scanWaiters = new Map<string, Set<(status: string) => void>>();

// Scans run in the shared queue and may wait behind other API workers during the full parallel suite.
function scanned(id: string, ms = 60_000): Promise<string> {
  const ready = scanResults.get(id);
  if (ready) return Promise.resolve(ready);

  return new Promise((resolve, reject) => {
    const waiters = scanWaiters.get(id) ?? new Set<(status: string) => void>();
    const finish = (status: string) => {
      clearTimeout(timeout);
      waiters.delete(finish);
      if (!waiters.size) scanWaiters.delete(id);
      resolve(status);
    };
    waiters.add(finish);
    scanWaiters.set(id, waiters);
    const timeout = setTimeout(() => {
      waiters.delete(finish);
      if (!waiters.size) scanWaiters.delete(id);
      reject(new Error(`File ${id} was not scanned within ${ms} ms`));
    }, ms);
  });
}

beforeAll(async () => {
  await rm(env().UPLOAD_DIR, { recursive: true, force: true });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  app.get(EventBus).on('file.scanned', (event) => {
    scanResults.set(event.payload.fileId, event.payload.status);
    for (const resolve of scanWaiters.get(event.payload.fileId) ?? []) resolve(event.payload.status);
  });

  [alice, bob] = [await register(1), await register(2)];
  admin = (await staffSession(http, prisma, 'ADMIN', `e2e-files-${run}-admin@example.com`)).accessToken;
  const service = await prisma.service.findFirstOrThrow();
  pdfOnly = (
    await prisma.serviceDocumentRequirement.create({
      data: { serviceId: service.id, name: `E2E PDF only ${run}`, acceptedTypes: ['application/pdf'], maxSizeMb: 1, packageIds: [] },
    })
  ).id;
});

afterAll(async () => {
  const users = { email: { startsWith: `e2e-files-${run}` } };
  await prisma.storedFile.deleteMany({ where: { owner: users } });
  await prisma.user.deleteMany({ where: users });
  await prisma.serviceDocumentRequirement.delete({ where: { id: pdfOnly } });
  await app.close();
  await rm(env().UPLOAD_DIR, { recursive: true, force: true });
});

describe('upload', () => {
  it('stores a valid file privately under a random key and records it', async () => {
    const res = await upload(alice, 'PAN card.png', PNG).expect(201);
    expect(storedFileSchema.strict().safeParse(res.body).error).toBeUndefined();
    expect(res.body).toMatchObject({ fileName: 'PAN card.png', mimeType: 'image/png', sizeBytes: PNG.length, requirementId: null, scanStatus: 'PENDING' });

    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.fileKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{32}$/);
    const onDisk = await storedOnDisk();
    expect(onDisk).toContain(join(env().UPLOAD_DIR, row.fileKey));
    expect(onDisk.some((p) => p.includes('PAN'))).toBe(false);
  });

  it('requires a login and a file', async () => {
    await http.post('/api/files').attach('file', PNG, 'a.png').expect(401);
    const res = await http.post('/api/files').set('authorization', `Bearer ${alice}`).field('note', 'no file').expect(400);
    expect(res.body.message).toBe('Choose a file to upload');
  });

  describe('rejections keep nothing', () => {
    let before: string[];
    let rows: number;
    beforeEach(async () => {
      before = await storedOnDisk();
      rows = await prisma.storedFile.count({ where: { owner: ownUsers } });
    });
    afterEach(async () => {
      expect(await storedOnDisk()).toEqual(before);
      expect(await prisma.storedFile.count({ where: { owner: ownUsers } })).toBe(rows);
    });

    it('rejects an oversized file (requirement limit 1 MB)', async () => {
      const big = Buffer.concat([PDF, Buffer.alloc(MB, 0x20)]);
      const res = await upload(alice, 'big.pdf', big, `?requirementId=${pdfOnly}`).expect(413);
      expect(res.body.message).toBe('File is too large. The limit is 1 MB.');
    });

    it('rejects an oversized file under the default 10 MB limit', async () => {
      await upload(alice, 'big.pdf', Buffer.concat([PDF, Buffer.alloc(10 * MB, 0x20)])).expect(413);
    });

    it('rejects extensions that are not accepted', async () => {
      const exe = await upload(alice, 'setup.exe', Buffer.from('MZ\x90\x00')).expect(415);
      expect(exe.body.message).toBe('Only PDF, JPG or PNG files are allowed');
      const png = await upload(alice, 'scan.png', PNG, `?requirementId=${pdfOnly}`).expect(415);
      expect(png.body.message).toBe('Only PDF files are allowed');
    });

    it('rejects content that does not match the extension (magic bytes)', async () => {
      const res = await upload(alice, 'invoice.pdf', PNG).expect(415);
      expect(res.body.message).toMatch(/not a real PDF file/);
      await upload(alice, 'photo.jpg', Buffer.from('<html><script>alert(1)</script></html>')).expect(415);
      await upload(alice, 'tiny.pdf', Buffer.from('%P')).expect(415);
    });

    it('ignores the browser-supplied Content-Type', async () => {
      await http.post('/api/files').set('authorization', `Bearer ${alice}`).attach('file', Buffer.from('MZ\x90\x00'), { filename: 'x.exe', contentType: 'application/pdf' }).expect(415);
    });

    it('rejects an unknown requirement', async () => {
      await upload(alice, 'a.pdf', PDF, '?requirementId=00000000-0000-4000-8000-000000000000').expect(400);
      await upload(alice, 'a.pdf', PDF, '?requirementId=../../etc').expect(400);
    });
  });
});

describe('download', () => {
  let fileId: string;
  beforeAll(async () => {
    fileId = (await upload(alice, 'Address proof.pdf', PDF, `?requirementId=${pdfOnly}`).expect(201)).body.id;
    expect(await scanned(fileId)).toBe('CLEAN');
  }, 90_000);

  it('gives the owner a 5-minute signed link that streams the file with safe headers', async () => {
    const link = await http.post(`/api/files/${fileId}/link`).set('authorization', `Bearer ${alice}`).expect(200);
    const ttl = Date.parse(link.body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000);

    const file = await http.get(link.body.url).buffer(true).expect(200);
    expect(Buffer.from(file.body).equals(PDF)).toBe(true);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="Address proof.pdf"; filename*=UTF-8''Address%20proof.pdf`);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('private, no-store');
  });

  it('can sign an inline (preview) link', async () => {
    const link = await http.post(`/api/files/${fileId}/link?disposition=inline`).set('authorization', `Bearer ${alice}`).expect(200);
    const file = await http.get(link.body.url).expect(200);
    expect(file.headers['content-disposition']).toMatch(/^inline;/);
  });

  it('does not give another customer a link (looks like a missing file)', async () => {
    const res = await http.post(`/api/files/${fileId}/link`).set('authorization', `Bearer ${bob}`).expect(404);
    expect(res.body.message).toBe('File not found');
    await http.post(`/api/files/${fileId}/link`).expect(401);
  });

  it('gives staff who can view all applications a link', async () => {
    await http.post(`/api/files/${fileId}/link`).set('authorization', `Bearer ${admin}`).expect(200);
  });

  it('refuses tampered, re-targeted and expired links', async () => {
    const { url } = (await http.post(`/api/files/${fileId}/link`).set('authorization', `Bearer ${alice}`).expect(200)).body;
    const u = new URL(url, 'http://x');

    const tampered = new URL(u);
    tampered.searchParams.set('e', String(Number(u.searchParams.get('e')) + 3600));
    await http.get(tampered.pathname + tampered.search).expect(403);

    const inline = new URL(u);
    inline.searchParams.set('d', 'inline');
    await http.get(inline.pathname + inline.search).expect(403);

    const other = (await upload(bob, 'bob.png', PNG).expect(201)).body.id;
    await scanned(other);
    await http.get(`/api/files/${other}/download${u.search}`).expect(403);

    await http.get(`/api/files/${fileId}/download`).expect(403);

    const expired = signedPath(fileId, Math.floor(Date.now() / 1000) - 1, 'attachment');
    const res = await http.get(expired).expect(403);
    expect(res.body.message).toMatch(/expired/);
  });
});

describe('virus scan', () => {
  it('blocks the EICAR test file: marked INFECTED, bytes deleted, no download', async () => {
    const events: DomainEvent<'file.scanned'>[] = [];
    const off = app.get(EventBus).on('file.scanned', (e) => void events.push(e));

    const eicar = Buffer.concat([PDF.subarray(0, 9), EICAR, Buffer.from('\n')]);
    const res = await upload(alice, 'eicar.pdf', eicar).expect(201);
    expect(res.body.scanStatus).toBe('PENDING');
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: res.body.id } });

    expect(await scanned(res.body.id)).toBe('INFECTED');
    off();
    const after = await prisma.storedFile.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(after).toMatchObject({ scanStatus: 'INFECTED', scanSignature: 'Eicar-Test-Signature' });
    expect(after.scannedAt).toBeInstanceOf(Date);
    expect(await storedOnDisk()).not.toContain(join(env().UPLOAD_DIR, row.fileKey));
    expect(events.map((e) => e.payload)).toContainEqual({ fileId: res.body.id, ownerId: row.ownerId, status: 'INFECTED', signature: 'Eicar-Test-Signature' });

    const link = await http.post(`/api/files/${res.body.id}/link`).set('authorization', `Bearer ${alice}`).expect(410);
    expect(link.body.message).toMatch(/virus was found/);
    await http.post(`/api/files/${res.body.id}/link`).set('authorization', `Bearer ${admin}`).expect(410);
    await http.post(`/api/files/${res.body.id}/link`).set('authorization', `Bearer ${bob}`).expect(404);
    // A correctly signed link is refused too.
    await http.get(signedPath(res.body.id, Math.floor(Date.now() / 1000) + 60, 'attachment')).expect(410);
  }, 90_000);

  it('gives no link while the scan is pending', async () => {
    const id = (await upload(alice, 'pending.pdf', PDF).expect(201)).body.id;
    expect(await scanned(id)).toBe('CLEAN');
    await prisma.storedFile.update({ where: { id }, data: { scanStatus: 'PENDING' } });

    const res = await http.post(`/api/files/${id}/link`).set('authorization', `Bearer ${alice}`).expect(409);
    expect(res.body.message).toMatch(/still being checked/);
    await http.get(signedPath(id, Math.floor(Date.now() / 1000) + 60, 'attachment')).expect(409);
  }, 90_000);

  it('shows scan status only to people who may read the file', async () => {
    const id = (await upload(alice, 'status.png', PNG).expect(201)).body.id;
    await http.get(`/api/files/${id}`).set('authorization', `Bearer ${bob}`).expect(404);
    await http.get(`/api/files/${id}`).expect(401);
    const res = await http.get(`/api/files/${id}`).set('authorization', `Bearer ${admin}`).expect(200);
    expect(storedFileSchema.strict().safeParse(res.body).error).toBeUndefined();
  });
});
