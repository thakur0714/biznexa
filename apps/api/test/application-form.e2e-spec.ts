/**
 * The application form page's API (M3.9): load a draft with its own form version, autosave answers,
 * full check on the final save, owner-only access, files must be the customer's own, DRAFT only.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { applicationDetailSchema, formSchema, GENERIC_SERVICE_FORM } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string;
let bob: string;
let packageId: string;
let appId: string;

const run = Date.now().toString().slice(-7);
const base = '/api/applications';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-form-${run}` } };

/** Version 1 is the one the draft is started on; version 2 (the generic form) is activated afterwards. */
const FORM = formSchema.parse({
  steps: [
    {
      title: 'Business',
      fields: [
        { type: 'text', name: 'businessName', label: 'Business name', required: true },
        { type: 'text', name: 'businessPan', label: 'PAN', required: true, pattern: '[A-Z]{5}[0-9]{4}[A-Z]', patternMessage: 'Enter a valid PAN' },
        { type: 'file', name: 'proof', label: 'Proof of address', required: false },
      ],
    },
    {
      title: 'Directors',
      fields: [
        {
          type: 'repeater',
          name: 'directors',
          label: 'Directors',
          itemLabel: 'Director',
          required: true,
          minItems: 1,
          fields: [
            { type: 'text', name: 'fullName', label: 'Full name', required: true },
            { type: 'number', name: 'share', label: 'Share (%)', required: true, min: 0, max: 100 },
          ],
        },
      ],
    },
  ],
});
const COMPLETE = { businessName: 'Acme Widgets', businessPan: 'AAACA1234F', directors: [{ fullName: 'Asha Rao', share: 60 }] };

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: 'Form Test', mobile: `7${run}${String(n).padStart(2, '0')}`, email: `e2e-form-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function storedFile(ownerId: string) {
  const f = await prisma.storedFile.create({
    data: { fileKey: `e2e-form-${randomUUID()}`, ownerId, originalName: 'proof.pdf', mimeType: 'pdf', sizeBytes: 10, sha256: '0'.repeat(64), scanStatus: 'CLEAN' },
  });
  return f.id;
}

const get = (token: string, id = appId) => http.get(`${base}/${id}`).set(as(token));
const save = (token: string, body: unknown, id = appId) => http.patch(`${base}/${id}`).set(as(token)).send(body as object);
const stored = async () => (await prisma.application.findUniqueOrThrow({ where: { id: appId } })).formData;

let aliceId: string;
let bobId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  ({ token: alice, id: aliceId } = await register(1));
  ({ token: bob, id: bobId } = await register(2));

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const svc = await prisma.service.create({
    data: {
      slug: `e2e-form-${run}`,
      categoryId: cat.id,
      name: 'Form answers (test)',
      shortDescription: 'A service used to test the application form page.',
      packages: { create: [{ name: 'Basic', professionalFee: 100000 }] },
      formSchemas: { create: [{ version: 1, schema: FORM as object, isCurrent: true }] },
    },
    select: { id: true, packages: { select: { id: true } } },
  });
  packageId = svc.packages[0].id;
  appId = (await http.post(base).set(as(alice)).send({ packageId }).expect(201)).body.id;

  // A newer form becomes current: the draft must keep using version 1.
  await prisma.$transaction([
    prisma.serviceFormSchema.updateMany({ where: { serviceId: svc.id }, data: { isCurrent: false } }),
    prisma.serviceFormSchema.create({ data: { serviceId: svc.id, version: 2, schema: GENERIC_SERVICE_FORM as object, isCurrent: true } }),
  ]);
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: { order: { customer: users } } });
  await prisma.order.deleteMany({ where: { customer: users } });
  await prisma.storedFile.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug: `e2e-form-${run}` } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('application form answers (M3.9)', () => {
  it('needs a login and only shows the customer their own application', async () => {
    await http.get(`${base}/${appId}`).expect(401);
    await http.patch(`${base}/${appId}`).send({ formData: {} }).expect(401);
    const missing = await get(alice, randomUUID()).expect(404);
    const other = await get(bob).expect(404);
    expect(other.body).toEqual(missing.body);
    await save(bob, { formData: { businessName: 'Hijack' } }).expect(404);
    expect(await stored()).toEqual({});
    await get(alice, 'not-a-uuid').expect(400);
  });

  it('loads the draft with the form version it was started on, not the current one', async () => {
    const detail = applicationDetailSchema.parse((await get(alice).expect(200)).body);
    expect(detail).toMatchObject({ id: appId, status: 'DRAFT', formSchemaVersion: 1, formData: {} });
    expect(detail.formSchema).toEqual(FORM);
  });

  it('autosaves half-finished answers and returns them on the next load (refresh keeps data)', async () => {
    const half = { businessName: 'Acme Wid', businessPan: 'AAAC', directors: [{ fullName: 'Asha' }], somethingElse: 'dropped' };
    const res = await save(alice, { formData: half }).expect(200);
    expect(res.body.formData).toEqual({ businessName: 'Acme Wid', businessPan: 'AAAC', directors: [{ fullName: 'Asha' }] });
    expect((await get(alice).expect(200)).body.formData).toEqual(res.body.formData);
  });

  it('refuses answers of the wrong shape even in autosave, with the field path, and keeps what was saved', async () => {
    const before = await stored();
    const res = await save(alice, { formData: { businessName: 'Acme', directors: [{ fullName: 'Asha', share: 'sixty' }] } }).expect(400);
    expect(res.body.errors).toEqual([expect.objectContaining({ field: 'directors.0.share' })]);
    expect(await stored()).toEqual(before);
  });

  it('rejects missing and invalid answers on the final save and lists each problem', async () => {
    const before = await stored();
    const res = await save(alice, { formData: { businessPan: 'AAAC', directors: [{ fullName: 'Asha' }] }, final: true }).expect(400);
    expect(res.body.message).toMatch(/missing or not valid/);
    const fields = res.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['businessName', 'businessPan', 'directors.0.share']));
    expect(res.body.errors.find((e: { field: string }) => e.field === 'businessPan').message).toBe('Enter a valid PAN');
    expect(await stored()).toEqual(before);
  });

  it('accepts complete answers on the final save and stores them cleaned', async () => {
    const res = await save(alice, { formData: { ...COMPLETE, directors: [{ fullName: ' Asha Rao ', share: '60' }] }, final: true }).expect(200);
    expect(res.body.formData).toEqual(COMPLETE);
    expect(await stored()).toEqual(COMPLETE);
  });

  it('only accepts files the customer uploaded', async () => {
    const mine = await storedFile(aliceId);
    const theirs = await storedFile(bobId);
    const res = await save(alice, { formData: { ...COMPLETE, proof: [theirs] } }).expect(400);
    expect(res.body.errors).toEqual([{ field: 'proof', message: 'Upload the file again' }]);
    await save(alice, { formData: { ...COMPLETE, proof: [randomUUID()] }, final: true }).expect(400);
    expect((await save(alice, { formData: { ...COMPLETE, proof: [mine] }, final: true }).expect(200)).body.formData.proof).toEqual([mine]);
  });

  it('refuses fields the customer may not set', async () => {
    await save(alice, { formData: COMPLETE, status: 'SUBMITTED' }).expect(400);
    await save(alice, { formData: 'nope' }).expect(400);
  });

  it('stops accepting answers once the application is no longer a draft', async () => {
    await prisma.application.update({ where: { id: appId }, data: { status: 'PAYMENT_PENDING' } });
    const before = await stored();
    await save(alice, { formData: { businessName: 'Changed' } }).expect(409);
    expect(await stored()).toEqual(before);
    expect((await get(alice).expect(200)).body.status).toBe('PAYMENT_PENDING');
  });
});
