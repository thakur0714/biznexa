/**
 * API integration tests against a real Postgres database (seeded with `pnpm db:seed`).
 * Each run uses unique emails/mobiles so it can be repeated safely.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adminCategoryListSchema,
  adminServiceDetailSchema,
  adminServiceListSchema,
  certificateOrgResultSchema,
  certificateVerifyResultSchema,
  type AdminCategoryRow,
  type AdminServiceDetail,
  type AdminServiceRow,
  type AnyDomainEvent,
} from '@biznexa/types';
import { buildOpenApiDocument, configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { qrSignature } from '../src/certificates/certificates.service';
import { EventBus } from '../src/events/event-bus';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
/** 2FA-verified staff sessions created for this run (D27). */
let adminToken: string;
let opsToken: string;

const run = Date.now().toString().slice(-7);
const mobile = (n: number) => `9${run}${String(n).padStart(2, '0')}`;
const email = (n: number) => `e2e-${run}-${n}@example.com`;

async function loginAs(emailAddr: string, password: string) {
  const res = await http.post('/api/auth/login').send({ email: emailAddr, password }).expect(200);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  adminToken = (await staffSession(http, prisma, 'ADMIN', email(90))).accessToken;
  opsToken = (await staffSession(http, prisma, 'OPERATIONS', email(91))).accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-${run}` } } });
  await prisma.service.deleteMany({ where: { slug: { startsWith: `e2e-${run}` } } });
  await app.close();
});

describe('health', () => {
  it('reports ok', async () => {
    const res = await http.get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('registration & login', () => {
  it('rejects invalid input with field errors', async () => {
    const res = await http.post('/api/auth/register').send({ name: 'A', mobile: '12345', email: 'bad', password: 'x', consent: false }).expect(400);
    const fields = res.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'mobile', 'email', 'password', 'consent']));
  });

  it('registers a customer, sets a refresh cookie and sends a mobile OTP', async () => {
    const res = await http
      .post('/api/auth/register')
      .send({ name: 'Test Customer', mobile: mobile(1), email: email(1), password: 'secret123', consent: true })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined(); // web clients get it only as an httpOnly cookie
    expect(res.headers['set-cookie'][0]).toMatch(/bn_rt=.*HttpOnly/);
    expect(res.body.user.roles).toEqual(['CUSTOMER']);
    expect(res.body.user.mobileVerified).toBe(false);
    expect(res.body.otp.devCode).toMatch(/^\d{6}$/);

    // verify the mobile number with the code
    await http.post('/api/auth/otp/verify').send({ channel: 'MOBILE', target: mobile(1), purpose: 'VERIFY_MOBILE', code: res.body.otp.devCode }).expect(200);
    const me = await http.get('/api/auth/me').set('authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body.mobileVerified).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    const res = await http.post('/api/auth/register').send({ name: 'Dup', mobile: mobile(2), email: email(1), password: 'secret123', consent: true }).expect(400);
    expect(res.body.message).toMatch(/already exists/);
  });

  it('logs in with email + password and rejects a wrong password', async () => {
    await http.post('/api/auth/login').send({ email: email(1), password: 'wrong-pass1' }).expect(401);
    const token = await loginAs(email(1), 'secret123');
    expect(token).toBeTruthy();
  });
});

describe('mobile OTP login', () => {
  it('logs in with a correct code, counts wrong attempts and blocks quick resends', async () => {
    const req = await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: mobile(1), purpose: 'LOGIN' }).expect(200);
    const code: string = req.body.devCode;

    await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: mobile(1), purpose: 'LOGIN' }).expect(429);

    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await http.post('/api/auth/otp/verify').send({ channel: 'MOBILE', target: mobile(1), purpose: 'LOGIN', code: wrong }).expect(400);
    expect(bad.body.message).toMatch(/4 attempts left/);

    const ok = await http.post('/api/auth/otp/verify').send({ channel: 'MOBILE', target: mobile(1), purpose: 'LOGIN', code }).expect(200);
    expect(ok.body.accessToken).toBeDefined();

    // a used code cannot be reused
    await http.post('/api/auth/otp/verify').send({ channel: 'MOBILE', target: mobile(1), purpose: 'LOGIN', code }).expect(400);
  });

  it('gives the same answer for unknown numbers (no account enumeration) and sends nothing', async () => {
    const res = await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: mobile(99), purpose: 'LOGIN' }).expect(200);
    expect(res.body.message).toMatch(/If this account exists/);
    expect(res.body.devCode).toBeUndefined();
  });

  it('resets a password through an OTP', async () => {
    const req = await http.post('/api/auth/otp/request').send({ channel: 'EMAIL', target: email(1), purpose: 'RESET_PASSWORD' }).expect(200);
    const v = await http.post('/api/auth/otp/verify').send({ channel: 'EMAIL', target: email(1), purpose: 'RESET_PASSWORD', code: req.body.devCode }).expect(200);
    await http.post('/api/auth/password/reset').send({ resetToken: v.body.resetToken, password: 'newsecret456' }).expect(200);
    await http.post('/api/auth/login').send({ email: email(1), password: 'secret123' }).expect(401);
    await loginAs(email(1), 'newsecret456');
  });
});

describe('refresh token rotation', () => {
  it('rotates the token and revokes the family when an old token is reused', async () => {
    const login = await http.post('/api/auth/login').set('x-client', 'mobile').send({ email: email(1), password: 'newsecret456' }).expect(200);
    const first = login.body.refreshToken as string;

    const r1 = await http.post('/api/auth/refresh').set('x-client', 'mobile').send({ refreshToken: first }).expect(200);
    const second = r1.body.refreshToken as string;
    expect(second).not.toEqual(first);

    // replaying the first token = theft signal → both tokens die
    await http.post('/api/auth/refresh').set('x-client', 'mobile').send({ refreshToken: first }).expect(401);
    await http.post('/api/auth/refresh').set('x-client', 'mobile').send({ refreshToken: second }).expect(401);
  });
});

describe('access control', () => {
  it('blocks anonymous and customer access to admin endpoints', async () => {
    await http.get('/api/admin/catalogue/services').expect(401);
    const customer = await loginAs(email(1), 'newsecret456');
    await http.get('/api/admin/catalogue/services').set('authorization', `Bearer ${customer}`).expect(403);
  });

  it('returns permissions with the session so the admin portal admits staff and turns customers away', async () => {
    const admin = await http.post('/api/auth/login').send({ email: 'admin@biznexa.local', password: 'Admin@12345' }).expect(200);
    expect(admin.body.user.permissions).toEqual(expect.arrayContaining(['admin.access', 'services.manage']));

    const support = await http.post('/api/auth/login').send({ email: 'support@biznexa.local', password: 'Support@12345' }).expect(200);
    expect(support.body.user.permissions).toContain('admin.access');
    expect(support.body.user.permissions).not.toContain('services.manage');

    const customer = await http.post('/api/auth/login').send({ email: email(1), password: 'newsecret456' }).expect(200);
    expect(customer.body.user.permissions).toEqual([]);

    const me = await http.get('/api/auth/me').set('authorization', `Bearer ${customer.body.accessToken}`).expect(200);
    expect(me.body.permissions).toEqual([]);
  });

  it('lets an operations executive review documents but not manage services', async () => {
    const ops = opsToken;
    await http.get('/api/admin/catalogue/services').set('authorization', `Bearer ${ops}`).expect(403);
  });
});

describe('catalogue', () => {
  it('lists categories with service counts', async () => {
    const res = await http.get('/api/catalogue/categories').expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(7);
    expect(res.body[0].serviceCount).toBeGreaterThan(0);
  });

  it('filters and sorts services', async () => {
    const res = await http.get('/api/catalogue/services?category=tax-gst&subcategory=income-tax&sort=price_asc').expect(200);
    const prices = res.body.items.map((s: { startingPrice: number }) => s.startingPrice);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
    expect(res.body.items.every((s: { subcategory: { slug: string } }) => s.subcategory.slug === 'income-tax')).toBe(true);
  });

  it('finds services despite typos', async () => {
    const res = await http.get('/api/catalogue/search?q=trademrk regstration').expect(200);
    expect(res.body.services[0].slug).toBe('trademark-registration');
  });

  it('returns a full service page with GST-inclusive package prices', async () => {
    const res = await http.get('/api/catalogue/services/trademark-registration').expect(200);
    const basic = res.body.packages[0];
    expect(basic.price.totalTax).toBe(Math.round((basic.professionalFee * 18) / 100));
    expect(basic.price.total).toBe(basic.professionalFee + basic.price.totalTax + basic.governmentFee);
    expect(res.body.documents.length).toBeGreaterThan(0);
    expect(res.body.stages.length).toBeGreaterThan(0);
  });

  it('lets an admin create a brand-new service without code changes, then hide it', async () => {
    const admin = adminToken;
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
    const slug = `e2e-${run}-pollution-noc`;
    const created = await http
      .post('/api/admin/catalogue/services')
      .set('authorization', `Bearer ${admin}`)
      .send({
        slug,
        categoryId: cat.id,
        name: 'Pollution NOC (test)',
        shortDescription: 'Consent to establish and operate from the State Pollution Control Board.',
        packages: [{ name: 'Basic', professionalFee: 499900, governmentFee: 100000 }],
        documents: [{ name: 'Site plan' }],
        stages: [{ name: 'Submitted' }, { name: 'Filed' }, { name: 'NOC issued' }],
        faqs: [{ question: 'How long is it valid?', answer: 'Usually five years.' }],
      })
      .expect(201);
    expect(created.body.packages).toHaveLength(1);

    const pub = await http.get(`/api/catalogue/services/${slug}`).expect(200);
    expect(pub.body.stages.map((s: { name: string }) => s.name)).toEqual(['Submitted', 'Filed', 'NOC issued']);

    // reorder stages
    const ids = created.body.stages.map((s: { id: string }) => s.id);
    await http
      .put(`/api/admin/catalogue/services/${created.body.id}/stages`)
      .set('authorization', `Bearer ${admin}`)
      .send([{ id: ids[1], name: 'Filed' }, { id: ids[0], name: 'Submitted' }, { id: ids[2], name: 'NOC issued' }])
      .expect(200);

    await http.patch(`/api/admin/catalogue/services/${created.body.id}`).set('authorization', `Bearer ${admin}`).send({ isActive: false }).expect(200);
    await http.get(`/api/catalogue/services/${slug}`).expect(404);

    const audit = await prisma.auditLog.count({ where: { entityId: created.body.id } });
    expect(audit).toBeGreaterThanOrEqual(3);
  });

  it('lets an admin find a service in the admin list, deactivate it and reactivate it (M2.5.8)', async () => {
    const admin = adminToken;
    const auth = { authorization: `Bearer ${admin}` };
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
    const slug = `e2e-${run}-toggle`;
    const { id } = (
      await http
        .post('/api/admin/catalogue/services')
        .set(auth)
        .send({
          slug,
          categoryId: cat.id,
          name: 'Toggle test service',
          shortDescription: 'A service used to check deactivate and reactivate.',
          packages: [{ name: 'Basic', professionalFee: 199900 }, { name: 'Pro', professionalFee: 99900, isActive: false }],
          stages: [{ name: 'Filed' }],
        })
        .expect(201)
    ).body;

    const list = async (query = '') => {
      const res = await http.get(`/api/admin/catalogue/services${query}`).set(auth).expect(200);
      expect(adminServiceListSchema.safeParse(res.body).error).toBeUndefined();
      return res.body as AdminServiceRow[];
    };
    const row = (await list(`?includeInactive=true&categoryId=${cat.id}`)).find((r) => r.id === id);
    expect(row).toMatchObject({ slug, isActive: true, category: { id: cat.id, name: cat.name }, startingPrice: 199900, activePackages: 1, applications: 0 });

    await http.patch(`/api/admin/catalogue/services/${id}`).set(auth).send({ isActive: false }).expect(200);
    await http.get(`/api/catalogue/services/${slug}`).expect(404);
    expect((await list()).some((r) => r.id === id)).toBe(false); // active only by default
    expect((await list('?includeInactive=true')).find((r) => r.id === id)?.isActive).toBe(false);

    await http.patch(`/api/admin/catalogue/services/${id}`).set(auth).send({ isActive: true }).expect(200);
    await http.get(`/api/catalogue/services/${slug}`).expect(200);
    expect((await list()).find((r) => r.id === id)?.isActive).toBe(true);

    await http.get('/api/admin/catalogue/services?categoryId=not-a-uuid').set(auth).expect(400);
  });

  it('builds a whole service the way the admin editor does, and it shows on the website (M2.5.9)', async () => {
    const admin = adminToken;
    const auth = { authorization: `Bearer ${admin}` };
    const cats = (await http.get('/api/admin/catalogue/categories').set(auth).expect(200)).body as AdminCategoryRow[];
    const cat = cats.find((c) => c.subcategories.length > 0)!;
    const other = cats.find((c) => c.id !== cat.id)!;
    const related = await prisma.service.findFirstOrThrow({ where: { slug: 'trademark-registration' } });
    const slug = `e2e-${run}-editor`;
    const basicId = crypto.randomUUID();
    const premiumId = crypto.randomUUID();
    const detail = (body: unknown) => {
      expect(adminServiceDetailSchema.safeParse(body).error).toBeUndefined();
      return body as AdminServiceDetail;
    };

    const body = {
      slug,
      categoryId: cat.id,
      subcategoryId: cat.subcategories[0].id,
      name: 'Editor test service',
      shortDescription: 'A service created with every tab of the admin editor filled in.',
      overview: 'First paragraph.\n\nSecond paragraph.',
      icon: 'stamp',
      imageUrl: '',
      benefits: ['Done online', 'Expert review'],
      estimatedDaysMin: 5,
      estimatedDaysMax: 9,
      sacCode: '998399',
      seoTitle: 'Editor test | BizNexa',
      metaDescription: 'Meta description for the editor test.',
      // New packages carry client ids so the document below can be limited to Premium in the same request.
      packages: [
        { id: basicId, name: 'Basic', professionalFee: 149900, governmentFee: 50000, inclusions: ['Filing'] },
        { id: premiumId, name: 'Premium', professionalFee: 299900, isMostPopular: true, allowPartial: true, advancePercent: 50 },
      ],
      documents: [{ name: 'PAN card' }, { name: 'Board resolution', isMandatory: false, acceptedTypes: ['application/pdf'], packageIds: [premiumId] }],
      stages: [{ name: 'Submitted' }, { name: 'Filed', description: 'With the department' }, { name: 'Done' }],
      faqs: [{ question: 'Is it online?', answer: 'Yes, fully.' }],
      relatedServiceIds: [related.id],
    };

    // refused: slug taken, subcategory of another category, document limited to an unknown package, two "most popular"
    const taken = await http.post('/api/admin/catalogue/services').set(auth).send({ ...body, slug: 'trademark-registration' }).expect(409);
    expect(taken.body.errors).toEqual([{ field: 'slug', message: 'Another service already uses this URL' }]);
    const wrongSub = await http.post('/api/admin/catalogue/services').set(auth).send({ ...body, categoryId: other.id }).expect(400);
    expect(wrongSub.body.errors[0].field).toBe('subcategoryId');
    const wrongPkg = await http
      .post('/api/admin/catalogue/services')
      .set(auth)
      .send({ ...body, documents: [{ name: 'PAN card', packageIds: [crypto.randomUUID()] }] })
      .expect(400);
    expect(wrongPkg.body.errors[0].field).toBe('documents.0.packageIds');
    await http
      .post('/api/admin/catalogue/services')
      .set(auth)
      .send({ ...body, packages: body.packages.map((p) => ({ ...p, isMostPopular: true })) })
      .expect(400);
    const invalid = await http.post('/api/admin/catalogue/services').set(auth).send({ ...body, packages: [{ ...body.packages[1], advancePercent: undefined }] }).expect(400);
    expect(invalid.body.errors[0].field).toBe('packages.0.advancePercent');
    expect(await prisma.service.count({ where: { slug } })).toBe(0);

    const created = detail((await http.post('/api/admin/catalogue/services').set(auth).send(body).expect(201)).body);
    expect(created.packages.map((p) => p.id)).toEqual([basicId, premiumId]);
    expect(created.documents[1].packageIds).toEqual([premiumId]);
    expect(created.imageUrl).toBeNull(); // blank → null
    expect(created.relatedServiceIds).toEqual([related.id]);

    const pub = (await http.get(`/api/catalogue/services/${slug}`).expect(200)).body;
    expect(pub).toMatchObject({ name: body.name, seoTitle: body.seoTitle, subcategory: { slug: expect.any(String) }, icon: 'stamp' });
    expect(pub.packages.map((p: { name: string }) => p.name)).toEqual(['Basic', 'Premium']);
    expect(pub.documents.map((d: { name: string }) => d.name)).toEqual(['PAN card', 'Board resolution']);
    expect(pub.faqs).toEqual(body.faqs);
    expect(pub.related.map((r: { slug: string }) => r.slug)).toEqual(['trademark-registration']);
    const listed = (await http.get(`/api/catalogue/services?category=${cat.slug}&limit=60`).expect(200)).body;
    expect(listed.items.some((s: { slug: string }) => s.slug === slug)).toBe(true);

    // edit: clear optional fields, move category (subcategory dropped), change related, remove a package
    const patched = detail(
      (await http.patch(`/api/admin/catalogue/services/${created.id}`).set(auth).send({ seoTitle: '', sacCode: null, categoryId: other.id }).expect(200)).body,
    );
    expect(patched).toMatchObject({ seoTitle: null, sacCode: null, categoryId: other.id, subcategoryId: null });
    await http.patch(`/api/admin/catalogue/services/${created.id}`).set(auth).send({ estimatedDaysMin: 20 }).expect(400); // max is 9

    await http.put(`/api/admin/catalogue/services/${created.id}/related`).set(auth).send([created.id]).expect(400);
    expect(detail((await http.put(`/api/admin/catalogue/services/${created.id}/related`).set(auth).send([]).expect(200)).body).relatedServiceIds).toEqual([]);

    const afterPkgs = detail(
      (
        await http
          .put(`/api/admin/catalogue/services/${created.id}/packages`)
          .set(auth)
          .send([{ ...body.packages[0], isMostPopular: true }])
          .expect(200)
      ).body,
    );
    expect(afterPkgs.packages.map((p) => p.name)).toEqual(['Basic']);
    expect(afterPkgs.documents[1].packageIds).toEqual([]); // Premium was deleted, so the document applies to every package again

    expect(await prisma.auditLog.count({ where: { entityId: created.id, action: 'service.related.update' } })).toBe(1); // the refused self-relation is not logged
  });

  it('lists every category with service counts for admins only', async () => {
    const admin = adminToken;
    const res = await http.get('/api/admin/catalogue/categories').set('authorization', `Bearer ${admin}`).expect(200);
    expect(adminCategoryListSchema.safeParse(res.body).error).toBeUndefined();
    const licenses = res.body.find((c: { slug: string }) => c.slug === 'licenses');
    const total = await prisma.service.count({ where: { category: { slug: 'licenses' }, deletedAt: null } });
    expect(licenses.services).toBe(total);
    expect(licenses.activeServices).toBeLessThanOrEqual(total);
    await http.get('/api/admin/catalogue/categories').expect(401);
  });
});

describe('certificate verification', () => {
  it('verifies by certificate number and by verification ID (case-insensitive)', async () => {
    const byNumber = await http.get('/api/public/certificates/verify?number=bnc-demo-000001').expect(200);
    expect(byNumber.body.found).toBe(true);
    expect(byNumber.body.certificate.status).toBe('ACTIVE');
    const byId = await http.get('/api/public/certificates/verify?id=demq9001actv').expect(200);
    expect(byId.body.certificate.certificateNumber).toBe('BNC-DEMO-000001');
  });

  it('shows suspended and expired certificates clearly', async () => {
    const s = await http.get('/api/public/certificates/verify?number=BNC-DEMO-000003').expect(200);
    expect(s.body.certificate.status).toBe('SUSPENDED');
    const e = await http.get('/api/public/certificates/verify?number=BNC-DEMO-000002').expect(200);
    expect(e.body.certificate.status).toBe('EXPIRED');
  });

  it('returns found=false for unknown certificates and logs every lookup', async () => {
    const before = await prisma.certificateLookup.count();
    const res = await http.get('/api/public/certificates/verify?number=DOES-NOT-EXIST').expect(200);
    expect(res.body.found).toBe(false);
    expect(await prisma.certificateLookup.count()).toBe(before + 1);
  });

  it('issues a certificate whose QR link is verifiable, and enforces status rules', async () => {
    const admin = adminToken;
    const body = await prisma.certificationBody.findFirstOrThrow();
    const issued = await http
      .post('/api/admin/certificates')
      .set('authorization', `Bearer ${admin}`)
      .send({ type: 'ISO 27001:2022', organizationName: `E2E Org ${run}`, issueDate: '2026-01-01', validFrom: '2026-01-01', validUntil: '2029-01-01', certificationBodyId: body.id })
      .expect(201);
    expect(issued.body.verificationId).toMatch(/^[A-Z2-9]{12}$/);
    expect(issued.body.qrUrl).toContain(`/verify/${issued.body.verificationId}?t=`);

    const t = qrSignature(issued.body.verificationId);
    const good = await http.get(`/api/public/certificates/verify?id=${issued.body.verificationId}&t=${t}`).expect(200);
    expect(good.body.qrAuthentic).toBe(true);
    const forged = await http.get(`/api/public/certificates/verify?id=${issued.body.verificationId}&t=0000000000000000`).expect(200);
    expect(forged.body.qrAuthentic).toBe(false);

    await http.patch(`/api/admin/certificates/${issued.body.id}/status`).set('authorization', `Bearer ${admin}`).send({ status: 'WITHDRAWN', reason: 'Test withdrawal' }).expect(200);
    await http.patch(`/api/admin/certificates/${issued.body.id}/status`).set('authorization', `Bearer ${admin}`).send({ status: 'ACTIVE', reason: 'Try to undo' }).expect(400);

    await prisma.certificateLookup.deleteMany({ where: { certificateId: issued.body.id } });
    await prisma.certificate.delete({ where: { id: issued.body.id } });
  });

  it('publishes domain events from the service to listeners, and not for refused changes', async () => {
    const admin = adminToken;
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: email(90) } });
    const body = await prisma.certificationBody.findFirstOrThrow();
    const seen: AnyDomainEvent[] = [];
    const off = app.get(EventBus).onAny((e) => void seen.push(e));
    try {
      const issued = await http
        .post('/api/admin/certificates')
        .set('authorization', `Bearer ${admin}`)
        .send({ type: 'ISO 9001:2015', organizationName: `E2E Events ${run}`, issueDate: '2026-01-01', validFrom: '2026-01-01', validUntil: '2029-01-01', certificationBodyId: body.id })
        .expect(201);
      const id = issued.body.id as string;
      const mine = () => seen.filter((e) => 'certificateId' in e.payload && e.payload.certificateId === id);

      await http.patch(`/api/admin/certificates/${id}/status`).set('authorization', `Bearer ${admin}`).send({ status: 'SUSPENDED', reason: 'Surveillance audit overdue' }).expect(200);
      await http.patch(`/api/admin/certificates/${id}/status`).set('authorization', `Bearer ${admin}`).send({ status: 'SUSPENDED', reason: 'Same status again' }).expect(400);

      expect(mine().map((e) => e.name)).toEqual(['certificate.issued', 'certificate.status_changed']);
      expect(mine()[1].payload).toEqual({
        certificateId: id,
        certificateNumber: issued.body.certificateNumber,
        from: 'ACTIVE',
        to: 'SUSPENDED',
        actorId: adminUser.id,
        reason: 'Surveillance audit overdue',
      });
      await prisma.certificate.delete({ where: { id } });
    } finally {
      off();
    }
  });
});

describe('OpenAPI document', () => {
  it('lists every route the API serves', () => {
    const doc = buildOpenApiDocument(app);
    const documented = new Set(Object.entries(doc.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`)));
    const stack = app.getHttpAdapter().getInstance().router.stack as { route?: { path: string; methods: Record<string, boolean> } }[];
    const served = stack
      .filter((layer) => layer.route)
      .flatMap(({ route }) => Object.keys(route!.methods).map((m) => `${m.toUpperCase()} ${route!.path.replace(/:(\w+)/g, '{$1}')}`));
    expect(served.length).toBeGreaterThan(30);
    expect(served.filter((r) => !documented.has(r))).toEqual([]);
  });

  it('matches the committed packages/api-client/openapi.json', () => {
    const committed = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/api-client/openapi.json'), 'utf8'));
    // If this fails: pnpm --filter @biznexa/api-client generate
    expect(JSON.parse(JSON.stringify(buildOpenApiDocument(app)))).toEqual(committed);
  });

  it('real responses match the published response schemas', async () => {
    for (const q of ['number=BNC-DEMO-000001', 'number=BNC-DEMO-000003', 'number=DOES-NOT-EXIST']) {
      const res = await http.get(`/api/public/certificates/verify?${q}`).expect(200);
      expect(certificateVerifyResultSchema.strict().safeParse(res.body).error).toBeUndefined();
    }
    const orgs = await http.get('/api/public/certificates/search?organization=demo').expect(200);
    expect(certificateOrgResultSchema.safeParse(orgs.body).error).toBeUndefined();
  });
});

