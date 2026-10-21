/**
 * Public website images (M9.4, D60) against a real database and throwaway UPLOAD_DIR / MEDIA_DIR
 * (see setup-env.js): upload rules, permissions, the public URL, and that private uploads can never
 * be read through /api/media.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { mediaImageSchema } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { env } from '../src/config/env';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let operations: string;
let customer: string;

const run = Date.now().toString().slice(-7);
const users = { email: { startsWith: `e2e-media-${run}` } };
const MB = 1024 * 1024;

const solid = (width = 32, height = 24) => sharp({ create: { width, height, channels: 3, background: '#2a6' } });

/** Binary body as a Buffer (supertest only buffers text and JSON by default). */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const upload = (token: string | null, name: string, data: Buffer) => {
  const req = http.post('/api/admin/media/images');
  if (token) req.set('authorization', `Bearer ${token}`);
  return req.attach('file', data, name);
};

async function filesIn(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  return (await readdir(root, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
}

beforeAll(async () => {
  await rm(env().MEDIA_DIR, { recursive: true, force: true });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  admin = (await staffSession(http, prisma, 'ADMIN', `e2e-media-${run}-admin@example.com`)).accessToken;
  operations = (await staffSession(http, prisma, 'OPERATIONS', `e2e-media-${run}-ops@example.com`)).accessToken;
  customer = (
    await http
      .post('/api/auth/register')
      .send({ name: 'Media Test', mobile: `7${run}11`, email: `e2e-media-${run}-c@example.com`, password: 'secret123', consent: true })
      .expect(201)
  ).body.accessToken;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.storedFile.deleteMany({ where: { owner: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
  await rm(env().MEDIA_DIR, { recursive: true, force: true });
});

describe('upload', () => {
  it('stores a re-encoded PNG and returns its public URL', async () => {
    const res = await upload(admin, 'office photo.png', await solid().png().toBuffer()).expect(201);
    const image = mediaImageSchema.parse(res.body);
    expect(image).toMatchObject({ mimeType: 'image/png', width: 32, height: 24 });
    expect(image.url).toMatch(/^\/api\/media\/[0-9a-f]{2}\/[0-9a-f]{32}\.png$/);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'media.uploaded', entityId: image.url.replace('/api/media/', '') } });
    expect(audit).not.toBeNull();
  });

  it('strips EXIF from a JPEG', async () => {
    const tagged = await solid().jpeg().withExif({ IFD0: { Artist: 'Secret Person' } }).toBuffer();
    const { url } = (await upload(admin, 'me.jpeg', tagged).expect(201)).body;
    expect(url).toMatch(/\.jpg$/);
    const stored = (await http.get(url).buffer(true).parse(binary).expect(200)).body as Buffer;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes('Secret Person')).toBe(false);
  });

  it('accepts WebP and GIF', async () => {
    expect((await upload(admin, 'a.webp', await solid().webp().toBuffer()).expect(201)).body.mimeType).toBe('image/webp');
    expect((await upload(admin, 'a.gif', await solid().gif().toBuffer()).expect(201)).body.mimeType).toBe('image/gif');
  });

  it('refuses other extensions, whatever the Content-Type says', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    await upload(admin, 'logo.svg', svg).expect(415);
    await http.post('/api/admin/media/images').set('authorization', `Bearer ${admin}`).attach('file', svg, { filename: 'x.html', contentType: 'image/png' }).expect(415);
    await upload(admin, 'doc.pdf', Buffer.from('%PDF-1.7\n')).expect(415);
  });

  it('checks the real type from the bytes', async () => {
    const before = await filesIn(env().MEDIA_DIR);
    await upload(admin, 'fake.png', Buffer.from('%PDF-1.7\n' + ' '.repeat(100))).expect(415);
    await upload(admin, 'fake.png', Buffer.from('<html><script>alert(1)</script></html>')).expect(415);
    await upload(admin, 'mixed.jpg', await solid().png().toBuffer()).expect(415);
    // Right magic bytes, but not a decodable image.
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1024, 7)]);
    const res = await upload(admin, 'broken.png', broken).expect(415);
    expect(res.body.message).toMatch(/could not be read/);
    expect(await filesIn(env().MEDIA_DIR)).toEqual(before);
  });

  it('enforces the size limit (5 MB)', async () => {
    const big = Buffer.concat([await solid().png().toBuffer(), Buffer.alloc(5 * MB + 1)]);
    const res = await upload(admin, 'big.png', big).expect(413);
    expect(res.body.message).toMatch(/5 MB/);
  });

  it('needs a file', async () => {
    await http.post('/api/admin/media/images').set('authorization', `Bearer ${admin}`).field('x', '1').expect(400);
  });

  it('needs cms.manage', async () => {
    const png = await solid().png().toBuffer();
    await upload(null, 'a.png', png).expect(401);
    await upload(customer, 'a.png', png).expect(403);
    await upload(operations, 'a.png', png).expect(403);
  });

  it('never writes media into the private upload folder', async () => {
    const before = await filesIn(env().UPLOAD_DIR);
    await upload(admin, 'a.png', await solid().png().toBuffer()).expect(201);
    expect(await filesIn(env().UPLOAD_DIR)).toEqual(before);
  });
});

describe('public URL', () => {
  it('serves the image without a login, cached for a year', async () => {
    const { url, sizeBytes } = (await upload(admin, 'cached.webp', await solid().webp().toBuffer()).expect(201)).body;
    const res = await http.get(url).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(Number(res.headers['content-length'])).toBe(sizeBytes);
    expect((await sharp(res.body as Buffer).metadata()).format).toBe('webp');
  });

  it('404s unknown and malformed keys without caching the miss', async () => {
    const res = await http.get(`/api/media/ab/${'0'.repeat(32)}.png`).expect(404);
    expect(res.headers['cache-control'] ?? '').not.toMatch(/immutable/);
    await http.get('/api/media/ab/not-a-key.png').expect(404);
    await http.get(`/api/media/ab/${'0'.repeat(32)}.svg`).expect(404);
    await http.get('/api/media/..%2F..%2F/etc%2Fpasswd').expect(404);
    await http.get('/api/media/%2E%2E/%2E%2E%2Fpackage.json').expect(404);
  });

  it('cannot reach a private upload', async () => {
    const png = await solid().png().toBuffer();
    const { id } = (await http.post('/api/files').set('authorization', `Bearer ${admin}`).attach('file', png, 'private.png').expect(201)).body;
    const { fileKey } = await prisma.storedFile.findUniqueOrThrow({ where: { id } });
    expect(fileKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{32}$/);

    for (const path of [`/api/media/${fileKey}`, `/api/media/${fileKey}.png`, `/api/media/${fileKey}.jpg`]) {
      await http.get(path).expect(404); // NOSONAR: tests run steps in order
    }
  });
});
