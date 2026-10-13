import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let ops: string;
let adminId: string;

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const prefix = `E2E-CB-${run}`;
const email = (n: number) => `e2e-cb-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: email(1) } })).id;
});

afterAll(async () => {
  const nameFilter = { startsWith: prefix };
  const certs = await prisma.certificate.findMany({ where: { certificationBody: { name: nameFilter } }, select: { id: true } });
  const certIds = certs.map((c) => c.id);
  if (certIds.length) {
    await prisma.certificateLookup.deleteMany({ where: { certificateId: { in: certIds } } });
    await prisma.certificate.deleteMany({ where: { id: { in: certIds } } });
  }
  await prisma.certificationBody.deleteMany({ where: { name: nameFilter } });
  await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-cb-${run}` } } });
  await app.close();
});

describe('admin certification bodies (M7.2)', () => {
  it('creates a certification body and logs audit', async () => {
    const name = `${prefix}-Body-1`;
    const res = await http
      .post('/api/admin/certificates/bodies')
      .set(as(admin))
      .send({
        name,
        accreditation: 'NABCB Accredited',
        website: 'https://example.com',
        logoUrl: 'https://example.com/logo.png',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      name,
      accreditation: 'NABCB Accredited',
      website: 'https://example.com',
      logoUrl: 'https://example.com/logo.png',
    });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'CertificationBody', entityId: res.body.id, action: 'certification_body.create' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses duplicate body name with 409', async () => {
    const name = `${prefix}-Body-Dup`;
    await http
      .post('/api/admin/certificates/bodies')
      .set(as(admin))
      .send({ name, website: 'https://example.com' })
      .expect(201);

    const dup = await http
      .post('/api/admin/certificates/bodies')
      .set(as(admin))
      .send({ name, website: 'https://example.org' })
      .expect(409);

    expect(dup.body.message).toMatch(/already exists/i);
  });

  it('refuses non-https website or logoUrl with 400', async () => {
    const name = `${prefix}-Body-BadUrl`;
    await http
      .post('/api/admin/certificates/bodies')
      .set(as(admin))
      .send({ name, website: 'http://insecure.com' })
      .expect(400);

    await http
      .post('/api/admin/certificates/bodies')
      .set(as(admin))
      .send({ name, logoUrl: 'ftp://files.com/logo.png' })
      .expect(400);
  });

  it('updates a certification body', async () => {
    const name = `${prefix}-Body-Edit`;
    const created = (
      await http
        .post('/api/admin/certificates/bodies')
        .set(as(admin))
        .send({ name, accreditation: 'Old Accreditation' })
        .expect(201)
    ).body;

    const res = await http
      .patch(`/api/admin/certificates/bodies/${created.id}`)
      .set(as(admin))
      .send({ accreditation: 'New Accreditation', website: 'https://updated.com' })
      .expect(200);

    expect(res.body).toMatchObject({
      id: created.id,
      name,
      accreditation: 'New Accreditation',
      website: 'https://updated.com',
    });
  });

  it('deletes an unused certification body', async () => {
    const name = `${prefix}-Body-Delete`;
    const created = (
      await http
        .post('/api/admin/certificates/bodies')
        .set(as(admin))
        .send({ name })
        .expect(201)
    ).body;

    await http.delete(`/api/admin/certificates/bodies/${created.id}`).set(as(admin)).expect(200);

    expect(await prisma.certificationBody.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('refuses delete with 409 when body is used by a certificate', async () => {
    const name = `${prefix}-Body-Used`;
    const body = (
      await http
        .post('/api/admin/certificates/bodies')
        .set(as(admin))
        .send({ name })
        .expect(201)
    ).body;

    await prisma.certificate.create({
      data: {
        certificateNumber: `BNC-TEST-${run}`,
        verificationId: `VERIFY${run}`,
        type: 'ISO 9001:2015',
        organizationName: 'Test Org',
        issueDate: new Date('2026-01-01'),
        validFrom: new Date('2026-01-01'),
        validUntil: new Date('2029-01-01'),
        certificationBodyId: body.id,
      },
    });

    const res = await http.delete(`/api/admin/certificates/bodies/${body.id}`).set(as(admin)).expect(409);
    expect(res.body.message).toMatch(/in use/i);
  });

  it('refuses staff without certificates.manage with 403', async () => {
    await http.get('/api/admin/certificates/bodies').set(as(ops)).expect(200); // GET is allowed for staff with cert permissions
    await http.post('/api/admin/certificates/bodies').set(as(ops)).send({ name: `${prefix}-Ops` }).expect(403);
    await http.patch(`/api/admin/certificates/bodies/${randomUUID()}`).set(as(ops)).send({ name: 'x' }).expect(403);
    await http.delete(`/api/admin/certificates/bodies/${randomUUID()}`).set(as(ops)).expect(403);
  });
});
