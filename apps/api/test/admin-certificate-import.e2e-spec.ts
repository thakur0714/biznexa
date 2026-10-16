import { randomInt } from 'node:crypto';
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

const run = `${Date.now().toString().slice(-6)}${randomInt(0, 100)}`;
const prefix = `E2E-IMP-${run}`;
const email = (n: number) => `e2e-imp-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

let testBody: { id: string; name: string };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;

  testBody = await prisma.certificationBody.create({
    data: { name: `${prefix}-Body` },
  });
});

afterAll(async () => {
  const certs = await prisma.certificate.findMany({
    where: {
      OR: [
        { certificateNumber: { startsWith: prefix } },
        { certificationBody: { name: { startsWith: prefix } } },
      ],
    },
    select: { id: true },
  });
  const certIds = certs.map((c) => c.id);
  if (certIds.length) {
    await prisma.certificateLookup.deleteMany({ where: { certificateId: { in: certIds } } });
    await prisma.certificate.deleteMany({ where: { id: { in: certIds } } });
  }
  await prisma.certificationBody.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.auditLog.deleteMany({ where: { action: 'certificate.bulk_import' } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-imp-${run}` } } });
  await app.close();
});

describe('admin certificate bulk import (M7.4)', () => {
  it('GET /api/admin/certificates/import/template returns downloadable CSV template', async () => {
    const res = await http.get('/api/admin/certificates/import/template').set(as(admin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('certificate-import-template.csv');
    expect(res.text).toContain('Certificate Number,Certificate Type,Organization Name');
  });

  it('POST /api/admin/certificates/import/preview validates CSV and returns preview rows', async () => {
    const csv = `Certificate Number,Certificate Type,Organization Name,Scope,Address,Issue Date,Valid From,Valid Until,Certification Body,Allow Public Download
${prefix}-001,ISO 9001:2015,Alpha Industries,Quality manufacturing,MIDC Mumbai,2026-01-01,2026-01-01,2029-01-01,${testBody.name},true
,ISO 27001:2022,Beta Infotech,Security management,Hitec City Hyderabad,2026-02-01,2026-02-01,2029-02-01,${testBody.id},false`;

    const res = await http
      .post('/api/admin/certificates/import/preview')
      .set(as(admin))
      .send({ csv });

    expect(res.status).toBe(201);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.validRows).toBe(2);
    expect(res.body.invalidRows).toBe(0);
    expect(res.body.errors).toEqual([]);
    expect(res.body.preview).toHaveLength(2);
    expect(res.body.preview[0].certificateNumber).toBe(`${prefix}-001`);
    expect(res.body.preview[0].organizationName).toBe('Alpha Industries');
    expect(res.body.preview[0].certificationBodyId).toBe(testBody.id);
    expect(res.body.preview[0].showPdfPublicly).toBe(true);
    expect(res.body.preview[1].organizationName).toBe('Beta Infotech');
    expect(res.body.preview[1].showPdfPublicly).toBe(false);
  });

  it('POST /api/admin/certificates/import/preview catches row errors (missing fields, dates, bodies, duplicate numbers)', async () => {
    // Existing certificate in DB
    await prisma.certificate.create({
      data: {
        certificateNumber: `${prefix}-EXISTING`,
        verificationId: `V${run}EXIST`,
        type: 'ISO 9001',
        organizationName: 'Existing Org',
        issueDate: new Date('2026-01-01'),
        validFrom: new Date('2026-01-01'),
        validUntil: new Date('2029-01-01'),
        certificationBodyId: testBody.id,
      },
    });

    const csvWithErrors = `Certificate Number,Certificate Type,Organization Name,Scope,Address,Issue Date,Valid From,Valid Until,Certification Body,Allow Public Download
${prefix}-EXISTING,ISO 9001:2015,Duplicate DB Cert,,,2026-01-01,2026-01-01,2029-01-01,${testBody.name},false
${prefix}-DUP,ISO 9001:2015,First Dup,,,2026-01-01,2026-01-01,2029-01-01,${testBody.name},false
${prefix}-DUP,ISO 9001:2015,Second Dup,,,2026-01-01,2026-01-01,2029-01-01,${testBody.name},false
,ISO 9001:2015,,,,2026-01-01,2026-01-01,2029-01-01,${testBody.name},false
,ISO 9001:2015,Bad Dates Org,,,2026-01-01,2029-01-01,2026-01-01,${testBody.name},false
,ISO 9001:2015,Unknown Body Org,,,2026-01-01,2026-01-01,2029-01-01,NonExistentBodyXYZ,false`;

    const res = await http
      .post('/api/admin/certificates/import/preview')
      .set(as(admin))
      .send({ csv: csvWithErrors });

    expect(res.status).toBe(201);
    expect(res.body.totalRows).toBe(6);
    expect(res.body.invalidRows).toBeGreaterThan(0);
    const messages = res.body.errors.map((e: { message: string }) => e.message);

    expect(messages.some((m: string) => m.includes('already exists in the database'))).toBe(true);
    expect(messages.some((m: string) => m.includes('Duplicate certificate number'))).toBe(true);
    expect(messages.some((m: string) => m.includes('Organisation name is required'))).toBe(true);
    expect(messages.some((m: string) => m.includes('Valid until must be after valid from'))).toBe(true);
    expect(messages.some((m: string) => m.includes('NonExistentBodyXYZ') && m.includes('not found'))).toBe(true);
  });

  it('POST /api/admin/certificates/import/error-report formats error report as CSV', async () => {
    const errors = [
      { rowNumber: 2, certificateNumber: `${prefix}-001`, organizationName: 'Acme', field: 'type', message: 'Type required' },
      { rowNumber: 3, organizationName: '=OrgFormula', field: 'validUntil', message: 'Date invalid' },
    ];

    const res = await http
      .post('/api/admin/certificates/import/error-report')
      .set(as(admin))
      .send({ errors });

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('certificate-import-errors.csv');
    expect(res.text).toContain('"Row Number","Certificate Number","Organisation","Field","Error Message"');
    expect(res.text).toContain(`"2","${prefix}-001","Acme","type","Type required"`);
    expect(res.text).toContain('\'=OrgFormula');
  });

  it('POST /api/admin/certificates/import rejects CSV with errors without importing any row', async () => {
    const invalidCsv = `Certificate Number,Certificate Type,Organization Name,Scope,Address,Issue Date,Valid From,Valid Until,Certification Body,Allow Public Download
${prefix}-REJECT-1,ISO 9001:2015,Valid Row,,,2026-01-01,2026-01-01,2029-01-01,${testBody.name},false
${prefix}-REJECT-2,ISO 9001:2015,,,,2026-01-01,2026-01-01,2029-01-01,${testBody.name},false`;

    const res = await http
      .post('/api/admin/certificates/import')
      .set(as(admin))
      .send({ csv: invalidCsv });

    expect(res.status).toBe(400);

    const inserted = await prisma.certificate.findFirst({
      where: { certificateNumber: `${prefix}-REJECT-1` },
    });
    expect(inserted).toBeNull();
  });

  it('POST /api/admin/certificates/import imports valid rows in one transaction and logs audit', async () => {
    const validCsv = `Certificate Number,Certificate Type,Organization Name,Scope,Address,Issue Date,Valid From,Valid Until,Certification Body,Allow Public Download
${prefix}-TX-1,ISO 9001:2015,TX Company 1,Scope 1,Addr 1,2026-01-01,2026-01-01,2029-01-01,${testBody.name},true
,ISO 27001:2022,TX Company 2,Scope 2,Addr 2,2026-02-01,2026-02-01,2029-02-01,${testBody.id},false`;

    const res = await http
      .post('/api/admin/certificates/import')
      .set(as(admin))
      .send({ csv: validCsv });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.importedCount).toBe(2);
    expect(res.body.certificateIds).toHaveLength(2);

    const c1 = await prisma.certificate.findUnique({ where: { id: res.body.certificateIds[0] } });
    expect(c1).not.toBeNull();
    expect(c1?.certificateNumber).toBe(`${prefix}-TX-1`);
    expect(c1?.organizationName).toBe('TX Company 1');
    expect(c1?.showPdfPublicly).toBe(true);
    expect(c1?.verificationId).toHaveLength(12);
    expect(c1?.status).toBe('ACTIVE');

    const c2 = await prisma.certificate.findUnique({ where: { id: res.body.certificateIds[1] } });
    expect(c2).not.toBeNull();
    expect(c2?.certificateNumber).toMatch(/^BNC-\d{4}-\d{6}$/);
    expect(c2?.organizationName).toBe('TX Company 2');
    expect(c2?.showPdfPublicly).toBe(false);

    // Verify audit log entry
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'certificate.bulk_import', entityId: res.body.certificateIds[0] },
    });
    expect(audit).not.toBeNull();
  });

  it('requires certificates.manage permission (operations without permission gets 403)', async () => {
    const res = await http
      .post('/api/admin/certificates/import/preview')
      .set(as(ops))
      .send({ csv: 'dummy' });
    expect(res.status).toBe(403);
  });
});
