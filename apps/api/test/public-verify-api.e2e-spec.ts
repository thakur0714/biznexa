import { randomInt } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { CAPTCHA_FREE_LOOKUPS, captchaLookupMap, verifyRateLimitMap } from '../src/certificates/certificates.controller';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

const run = `${Date.now().toString().slice(-6)}${randomInt(0, 100)}`;
const prefix = `VERIFY-${run}`;

let testBody: { id: string; name: string };
let activeCert: { id: string; certificateNumber: string; verificationId: string };
let suspendedCert: { id: string; certificateNumber: string; verificationId: string };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  testBody = await prisma.certificationBody.create({
    data: {
      name: `${prefix}-Body`,
      accreditation: 'NABCB Accredited',
      website: 'https://example.com',
    },
  });

  const c1 = await prisma.certificate.create({
    data: {
      certificateNumber: `${prefix}-001`,
      verificationId: `V${run}001`,
      type: 'ISO 9001:2015',
      organizationName: `${prefix} Acme Technologies`,
      scope: 'Design, manufacture, and distribution of electronics',
      issueDate: new Date('2026-01-01'),
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2029-01-01'),
      status: 'ACTIVE',
      certificationBodyId: testBody.id,
      pdfKey: 'test-pdf-key',
      showPdfPublicly: true,
    },
  });
  activeCert = { id: c1.id, certificateNumber: c1.certificateNumber, verificationId: c1.verificationId };

  const c2 = await prisma.certificate.create({
    data: {
      certificateNumber: `${prefix}-002`,
      verificationId: `V${run}002`,
      type: 'ISO 27001:2022',
      organizationName: `${prefix} Suspended Org`,
      issueDate: new Date('2025-01-01'),
      validFrom: new Date('2025-01-01'),
      validUntil: new Date('2028-01-01'),
      status: 'SUSPENDED',
      statusReason: 'Surveillance audit non-conformity',
      certificationBodyId: testBody.id,
      showPdfPublicly: false,
    },
  });
  suspendedCert = { id: c2.id, certificateNumber: c2.certificateNumber, verificationId: c2.verificationId };
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
  await app.close();
});

describe('Public verify API GET /api/public/certificates/verify (M7.7)', () => {
  beforeEach(() => {
    verifyRateLimitMap.clear();
    captchaLookupMap.clear();
  });

  it('verifies active certificate by number with rate limit headers and logs lookup', async () => {
    const res = await Promise.resolve(http.get(`/api/public/certificates/verify?number=${activeCert.certificateNumber}`));
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('30');
    expect(res.headers['x-ratelimit-remaining']).toBe('29');
    expect(res.headers['x-ratelimit-reset']).toBeDefined();

    expect(res.body.found).toBe(true);
    expect(res.body.verifiedAt).toBeDefined();
    expect(res.body.certificate).toBeDefined();
    expect(res.body.certificate.certificateNumber).toBe(activeCert.certificateNumber);
    expect(res.body.certificate.type).toBe('ISO 9001:2015');
    expect(res.body.certificate.status).toBe('ACTIVE');
    expect(res.body.certificate.pdfAvailable).toBe(true);
    expect(res.body.certificate.certificationBody.name).toBe(testBody.name);

    // Verify lookup was logged with method NUMBER
    const lookup = await prisma.certificateLookup.findFirst({
      where: { certificateId: activeCert.id, query: activeCert.certificateNumber },
      orderBy: { createdAt: 'desc' },
    });
    expect(lookup).not.toBeNull();
    expect(lookup?.found).toBe(true);
    expect(lookup?.method).toBe('NUMBER');
  });

  it('verifies certificate by verification ID and indicates suspended status note', async () => {
    const res = await Promise.resolve(http.get(`/api/public/certificates/verify?id=${suspendedCert.verificationId}`));
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.certificate.certificateNumber).toBe(suspendedCert.certificateNumber);
    expect(res.body.certificate.status).toBe('SUSPENDED');
    expect(res.body.certificate.statusNote).toContain('temporarily suspended');
    expect(res.body.certificate.pdfAvailable).toBe(false);

    const lookup = await prisma.certificateLookup.findFirst({
      where: { certificateId: suspendedCert.id, query: suspendedCert.verificationId },
      orderBy: { createdAt: 'desc' },
    });
    expect(lookup?.method).toBe('VERIFICATION_ID');
  });

  it('returns found: false for unknown certificate number', async () => {
    const res = await Promise.resolve(http.get('/api/public/certificates/verify?number=NON-EXISTENT-999'));
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.verifiedAt).toBeDefined();
    expect(res.body.certificate).toBeUndefined();

    const lookup = await prisma.certificateLookup.findFirst({
      where: { query: 'NON-EXISTENT-999' },
      orderBy: { createdAt: 'desc' },
    });
    expect(lookup).not.toBeNull();
    expect(lookup?.found).toBe(false);
  });

  it('accepts optional valid partner API key via X-API-Key header with higher rate limits (300) and logs API method', async () => {
    const res = await Promise.resolve(
      http
        .get(`/api/public/certificates/verify?number=${activeCert.certificateNumber}`)
        .set('X-API-Key', 'bn_live_partner_acme999'),
    );

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('300');
    expect(res.headers['x-ratelimit-remaining']).toBe('299');
    expect(res.body.found).toBe(true);

    const lookup = await prisma.certificateLookup.findFirst({
      where: { certificateId: activeCert.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(lookup?.method).toBe('API');
  });

  it('accepts optional valid partner API key via apiKey query param', async () => {
    const res = await Promise.resolve(
      http.get(
        `/api/public/certificates/verify?number=${activeCert.certificateNumber}&apiKey=bn_test_partner_key`,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('300');
    expect(res.body.found).toBe(true);
  });

  it('rejects invalid API key with 401 Unauthorized', async () => {
    const res = await Promise.resolve(
      http
        .get(`/api/public/certificates/verify?number=${activeCert.certificateNumber}`)
        .set('X-API-Key', 'invalid_partner_key'),
    );

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('Invalid API key');
  });

  it('enforces rate limit and returns 429 Too Many Requests when limit is exceeded', async () => {
    // Fill the rate limit bucket for this test IP
    verifyRateLimitMap.set('ip:127.0.0.1', { count: 30, resetAt: Date.now() + 60_000 });
    verifyRateLimitMap.set('ip:::ffff:127.0.0.1', { count: 30, resetAt: Date.now() + 60_000 });

    const res = await Promise.resolve(http.get(`/api/public/certificates/verify?number=${activeCert.certificateNumber}`));
    expect(res.status).toBe(429);
    expect(res.body.message).toContain('Rate limit exceeded');
  });
});

describe('Captcha after repeated lookups (M12.3)', () => {
  const verify = (extra = '') => http.get(`/api/public/certificates/verify?number=${activeCert.certificateNumber}${extra}`);

  beforeEach(() => {
    verifyRateLimitMap.clear();
    captchaLookupMap.clear();
  });

  it('asks for a captcha after the free lookups, accepts a valid token and then allows more lookups', async () => {
    for (let i = 0; i < CAPTCHA_FREE_LOOKUPS; i++) await verify().expect(200);

    const blocked = await verify().expect(429);
    expect(blocked.body.captchaRequired).toBe(true);

    const wrong = await verify('&captchaToken=nope').expect(429);
    expect(wrong.body.captchaRequired).toBe(true);

    const solved = await verify('&captchaToken=pass').expect(200);
    expect(solved.body.found).toBe(true);
    // Solving starts the count again: the solved lookup was the first, so the rest of the free ones work.
    for (let i = 1; i < CAPTCHA_FREE_LOOKUPS; i++) await verify().expect(200);
    expect((await verify().expect(429)).body.captchaRequired).toBe(true);
  });

  it('solving the captcha resets only that IP, not other visitors', async () => {
    captchaLookupMap.set('203.0.113.9', { count: CAPTCHA_FREE_LOOKUPS, resetAt: Date.now() + 600_000 });
    for (let i = 0; i < CAPTCHA_FREE_LOOKUPS; i++) await verify().expect(200);
    await verify('&captchaToken=pass').expect(200);
    expect(captchaLookupMap.get('203.0.113.9')?.count).toBe(CAPTCHA_FREE_LOOKUPS);
  });

  it('never asks partner API keys for a captcha', async () => {
    for (let i = 0; i < CAPTCHA_FREE_LOOKUPS + 3; i++) {
      await http.get(`/api/public/certificates/verify?number=${activeCert.certificateNumber}`).set('X-API-Key', 'bn_live_partner_acme999').expect(200);
    }
  });
});
