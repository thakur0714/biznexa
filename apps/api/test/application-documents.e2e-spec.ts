/**
 * The document step's API (M3.10): checklist from the service's requirements filtered by package,
 * uploads through the shared upload endpoint attached as versions, replacements keep earlier
 * versions, owner-only access, and the file rules (own file, uploaded for this requirement, not reused).
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { documentChecklistSchema, type DomainEvent } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string;
let aliceId: string;
let bob: string;
let appId: string;
let basicId: string;
let premiumId: string;
let pan: string; // mandatory, every package
let address: string; // mandatory, every package
let photo: string; // optional, every package
let premiumOnly: string; // mandatory, Premium only
const uploadedEvents: DomainEvent<'document.uploaded'>[] = [];

const run = Date.now().toString().slice(-7);
const slug = `e2e-docs-${run}`;
const users = { email: { startsWith: `e2e-docs-${run}` } };
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: 'Docs Test', mobile: `6${run}${String(n).padStart(2, '0')}`, email: `e2e-docs-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** A real upload through `POST /api/files` with the requirement's rules. */
async function upload(token: string, requirementId: string, name = 'doc.pdf') {
  const res = await http.post(`/api/files?requirementId=${requirementId}`).set(as(token)).attach('file', PDF, name).expect(201);
  return res.body.id as string;
}

const checklist = (token: string, id = appId) => http.get(`/api/applications/${id}/documents`).set(as(token));
const attach = (token: string, requirementId: string, fileId: string, id = appId) =>
  http.post(`/api/applications/${id}/documents/${requirementId}`).set(as(token)).send({ fileId });
const item = (body: unknown, requirementId: string) => documentChecklistSchema.parse(body).items.find((i) => i.requirement.id === requirementId);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  app.get(EventBus).on('document.uploaded', (e) => void uploadedEvents.push(e));
  ({ token: alice, id: aliceId } = await register(1));
  ({ token: bob } = await register(2));

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const svc = await prisma.service.create({
    data: {
      slug,
      categoryId: cat.id,
      name: 'Documents (test)',
      shortDescription: 'A service used to test the document step.',
      packages: { create: [{ name: 'Basic', professionalFee: 100000, sortOrder: 0 }, { name: 'Premium', professionalFee: 200000, sortOrder: 1 }] },
      formSchemas: { create: [{ version: 1, schema: { steps: [{ title: 'You', fields: [{ type: 'text', name: 'x', label: 'X' }] }] }, isCurrent: true }] },
    },
    select: { id: true, packages: { orderBy: { sortOrder: 'asc' }, select: { id: true } } },
  });
  [basicId, premiumId] = svc.packages.map((p) => p.id);
  const req = (name: string, sortOrder: number, extra: object = {}) =>
    prisma.serviceDocumentRequirement.create({ data: { serviceId: svc.id, name, sortOrder, ...extra }, select: { id: true } }).then((r) => r.id);
  pan = await req('PAN card', 0, { acceptedTypes: ['application/pdf'], maxSizeMb: 1 });
  address = await req('Address proof', 1);
  photo = await req('Photograph', 2, { isMandatory: false });
  premiumOnly = await req('Board resolution', 3, { packageIds: [premiumId] });

  appId = (await http.post('/api/applications').set(as(alice)).send({ packageId: basicId }).expect(201)).body.id;
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: { order: { customer: users } } });
  await prisma.order.deleteMany({ where: { customer: users } });
  await prisma.storedFile.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('application documents (M3.10)', () => {
  it('needs a login and hides other customers’ applications', async () => {
    await http.get(`/api/applications/${appId}/documents`).expect(401);
    const missing = await checklist(alice, randomUUID()).expect(404);
    const other = await checklist(bob).expect(404);
    expect(other.body).toEqual(missing.body);

    const file = await upload(bob, pan);
    await attach(bob, pan, file).expect(404);
    expect(await prisma.applicationDocument.count({ where: { applicationId: appId } })).toBe(0);
  });

  it('lists the requirements for the application’s package, all still required', async () => {
    const body = documentChecklistSchema.parse((await checklist(alice).expect(200)).body);
    expect(body.items.map((i) => i.requirement.name)).toEqual(['PAN card', 'Address proof', 'Photograph']); // not the Premium-only one
    expect(body.items.every((i) => i.current === null && i.previous.length === 0 && i.canReplace)).toBe(true);
    expect(body).toMatchObject({ applicationId: appId, canUpload: true, pendingMandatory: 2 });
    expect(item(body, pan)!.requirement).toMatchObject({ acceptedTypes: ['application/pdf'], maxSizeMb: 1, isMandatory: true });
  });

  it('refuses a document that is not on this package’s checklist', async () => {
    const file = await upload(alice, premiumOnly);
    await attach(alice, premiumOnly, file).expect(404);
    await attach(alice, randomUUID(), file).expect(404);
  });

  it('uploads a document as version 1 with status UPLOADED', async () => {
    const fileId = await upload(alice, pan, 'pan.pdf');
    const res = await attach(alice, pan, fileId).expect(201);
    const body = documentChecklistSchema.parse(res.body);
    expect(item(body, pan)!.current).toMatchObject({ version: 1, status: 'UPLOADED', fileId, fileName: 'pan.pdf', mimeType: 'application/pdf' });
    expect(body.pendingMandatory).toBe(1);

    const row = await prisma.applicationDocument.findFirstOrThrow({ where: { applicationId: appId, requirementId: pan } });
    expect(row).toMatchObject({ name: 'PAN card', version: 1, isLatest: true, status: 'UPLOADED', fileName: 'pan.pdf' });
    expect(row.uploadedAt).toBeInstanceOf(Date);
    expect(uploadedEvents.at(-1)!.payload).toEqual({ documentId: row.id, applicationId: appId, requirementId: pan, version: 1, actorId: aliceId });
  });

  it('replacing a file creates version 2 and keeps version 1', async () => {
    const before = await prisma.applicationDocument.findFirstOrThrow({ where: { applicationId: appId, requirementId: pan } });
    const fileId = await upload(alice, pan, 'pan-clear.pdf');
    const body = documentChecklistSchema.parse((await attach(alice, pan, fileId).expect(201)).body);

    const pa = item(body, pan)!;
    expect(pa.current).toMatchObject({ version: 2, status: 'UPLOADED', fileName: 'pan-clear.pdf', fileId });
    expect(pa.previous).toHaveLength(1);
    expect(pa.previous[0]).toMatchObject({ id: before.id, version: 1, fileName: 'pan.pdf' });

    const rows = await prisma.applicationDocument.findMany({ where: { applicationId: appId, requirementId: pan }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.isLatest, r.fileKey])).toEqual([
      [1, false, before.fileKey],
      [2, true, expect.any(String)],
    ]);
    expect(rows[1].fileKey).not.toBe(before.fileKey);
    // Version 1's file is still there and still the customer's to download.
    expect(await prisma.storedFile.count({ where: { fileKey: before.fileKey! } })).toBe(1);
    expect(uploadedEvents.at(-1)!.payload.version).toBe(2);
  });

  it('never gives two concurrent replacements the same version', async () => {
    const files = await Promise.all([upload(alice, address), upload(alice, address), upload(alice, address)]);
    const results = await Promise.all(files.map((f) => attach(alice, address, f)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const rows = await prisma.applicationDocument.findMany({ where: { applicationId: appId, requirementId: address }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(rows.filter((r) => r.isLatest).map((r) => r.version)).toEqual([3]);

    const body = documentChecklistSchema.parse((await checklist(alice).expect(200)).body);
    expect(body.pendingMandatory).toBe(0); // the optional photograph never blocks
  });

  it('only takes the customer’s own file, uploaded for this document, and not one already attached', async () => {
    const bobs = await upload(bob, photo);
    const r1 = await attach(alice, photo, bobs).expect(400);
    expect(r1.body.errors).toEqual([{ field: 'fileId', message: 'The file could not be found. Upload it again.' }]);

    // Uploaded under the address proof's rules, so the photograph's rules were never checked.
    const wrongRule = await upload(alice, address);
    expect((await attach(alice, photo, wrongRule).expect(400)).body.message).toMatch(/not uploaded for “Photograph”/);
    const noRule = (await http.post('/api/files').set(as(alice)).attach('file', PDF, 'x.pdf').expect(201)).body.id;
    await attach(alice, photo, noRule).expect(400);

    const panFile = (await prisma.applicationDocument.findFirstOrThrow({ where: { applicationId: appId, requirementId: pan, isLatest: true }, include: { file: true } })).file!;
    expect((await attach(alice, pan, panFile.id).expect(400)).body.message).toMatch(/already attached/);

    const infected = await upload(alice, photo);
    await prisma.storedFile.update({ where: { id: infected }, data: { scanStatus: 'INFECTED' } });
    expect((await attach(alice, photo, infected).expect(400)).body.message).toMatch(/virus/);

    await attach(alice, photo, 'not-a-uuid').expect(400);
    await http.post(`/api/applications/${appId}/documents/${photo}`).set(as(alice)).send({ fileId: randomUUID(), version: 9 }).expect(400);
    expect(await prisma.applicationDocument.count({ where: { applicationId: appId, requirementId: photo } })).toBe(0);
  });

  it('can’t replace a document under review or approved, but can after a rejection', async () => {
    const latest = () => prisma.applicationDocument.findFirstOrThrow({ where: { applicationId: appId, requirementId: pan, isLatest: true } });
    const setStatus = async (status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED') => prisma.applicationDocument.update({ where: { id: (await latest()).id }, data: { status } });

    await setStatus('UNDER_REVIEW');
    expect(item((await checklist(alice)).body, pan)!.canReplace).toBe(false);
    expect((await attach(alice, pan, await upload(alice, pan)).expect(409)).body.message).toMatch(/being reviewed/);
    await setStatus('APPROVED');
    expect((await attach(alice, pan, await upload(alice, pan)).expect(409)).body.message).toMatch(/already approved/);

    await setStatus('REJECTED');
    const body = documentChecklistSchema.parse((await checklist(alice)).body);
    expect(body.pendingMandatory).toBe(1); // a rejected document needs the customer again
    await attach(alice, pan, await upload(alice, pan)).expect(201);
    expect(await latest()).toMatchObject({ version: 3, status: 'UPLOADED' });
  });

  it('allows uploading later, after payment, but not once the application is past document collection', async () => {
    await prisma.application.update({ where: { id: appId }, data: { status: 'DOCUMENTS_PENDING' } });
    await attach(alice, photo, await upload(alice, photo)).expect(201);

    await prisma.application.update({ where: { id: appId }, data: { status: 'IN_PROGRESS' } });
    const body = documentChecklistSchema.parse((await checklist(alice).expect(200)).body);
    expect(body.canUpload).toBe(false);
    const fileId = await upload(alice, photo);
    await attach(alice, photo, fileId).expect(409);
    expect(await prisma.applicationDocument.count({ where: { applicationId: appId, requirementId: photo } })).toBe(1);
  });

  it('keeps showing a document whose requirement was later limited to another package', async () => {
    await prisma.serviceDocumentRequirement.update({ where: { id: photo }, data: { packageIds: [premiumId] } });
    const body = documentChecklistSchema.parse((await checklist(alice).expect(200)).body);
    expect(item(body, photo)!.current).toMatchObject({ version: 1 });
  });
});
