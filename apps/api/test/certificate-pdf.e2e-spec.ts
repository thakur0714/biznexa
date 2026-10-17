import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomInt, randomUUID } from 'node:crypto';
import { QueueEvents } from 'bullmq';
import { PERMS } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/files/storage.service';
import { signedPath } from '../src/files/files.service';
import { EventBus } from '../src/events/event-bus';
import { QueueService } from '../src/queue/queue.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let storage: StorageService;
let alice: string;
let aliceId: string;
let bob: string;
let admin: string;
let bodyId: string;
let entityId: string;
let events: EventBus;
let pdfQueueEvents: QueueEvents;
const generatedPdfKeys = new Map<string, string>();
const generatedPdfWaiters = new Map<string, Set<(key: string) => void>>();
const completedPdfJobs = new Map<string, Set<() => void>>();
const completedPdfJobIds = new Set<string>();

const run = randomUUID();
const mobileRun = String(randomInt(1_000_000, 10_000_000));
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-certpdf-${run}` } };
const writtenKeys: string[] = [];

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({
      name: `Cert PDF User ${n}`,
      mobile: `8${mobileRun}${String(10 + n).padStart(2, '0')}`,
      email: `e2e-certpdf-${run}-${n}@example.com`,
      password: 'secretPassword123!',
      consent: true,
    })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function stored(key: string) {
  const { stream } = await storage.read(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const binary = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
  const data: Buffer[] = [];
  res.on('data', (c: Buffer) => data.push(c));
  res.on('end', () => callback(null, Buffer.concat(data)));
};

// Chromium rendering may wait behind other PDF jobs in the full parallel API run.
function waitForGeneratedPdf(certId: string, ms = 120_000) {
  const ready = generatedPdfKeys.get(certId);
  if (ready) return Promise.resolve(ready);

  return new Promise<string>((resolve, reject) => {
    const waiters = generatedPdfWaiters.get(certId) ?? new Set<(key: string) => void>();
    const finish = (key: string) => {
      clearTimeout(timeout);
      waiters.delete(finish);
      if (!waiters.size) generatedPdfWaiters.delete(certId);
      resolve(key);
    };
    waiters.add(finish);
    generatedPdfWaiters.set(certId, waiters);
    const timeout = setTimeout(() => {
      waiters.delete(finish);
      if (!waiters.size) generatedPdfWaiters.delete(certId);
      reject(new Error(`PDF generation was not completed for certificate ${certId} within ${ms} ms`));
    }, ms);
  });
}

function waitForPdfJobCompletion(certId: string, ms = 120_000) {
  const jobId = `certificate-${certId}`;
  if (completedPdfJobIds.has(jobId)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const waiters = completedPdfJobs.get(jobId) ?? new Set<() => void>();
    const finish = () => {
      clearTimeout(timeout);
      waiters.delete(finish);
      if (!waiters.size) completedPdfJobs.delete(jobId);
      resolve();
    };
    waiters.add(finish);
    completedPdfJobs.set(jobId, waiters);
    const timeout = setTimeout(() => {
      waiters.delete(finish);
      if (!waiters.size) completedPdfJobs.delete(jobId);
      reject(new Error(`PDF queue job ${jobId} was not completed within ${ms} ms`));
    }, ms);
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  storage = app.get(StorageService);
  events = app.get(EventBus);
  const pdfQueue = app.get(QueueService).queue('pdf');
  pdfQueueEvents = new QueueEvents('pdf', { connection: pdfQueue.opts.connection, prefix: pdfQueue.opts.prefix });
  pdfQueueEvents.on('completed', ({ jobId }) => {
    completedPdfJobIds.add(jobId);
    for (const resolve of completedPdfJobs.get(jobId) ?? []) resolve();
  });
  await pdfQueueEvents.waitUntilReady();
  events.on('pdf.generated', (event) => {
    if (event.payload.kind !== 'certificate') return;
    generatedPdfKeys.set(event.payload.id, event.payload.fileKey);
    for (const resolve of generatedPdfWaiters.get(event.payload.id) ?? []) resolve(event.payload.fileKey);
  });

  const uAlice = await register(1);
  alice = uAlice.token;
  aliceId = uAlice.id;

  const uBob = await register(2);
  bob = uBob.token;

  const staff = await staffSession(http, prisma, 'ADMIN', `e2e-certpdf-${run}-admin@example.com`);
  admin = staff.accessToken;

  const body = await prisma.certificationBody.create({
    data: {
      name: `Body Cert PDF ${run}`,
      accreditation: 'NABCB Test Board',
      website: 'https://example.com/accreditation',
    },
  });
  bodyId = body.id;

  const entity = await prisma.businessEntity.create({
    data: {
      ownerId: aliceId,
      legalName: `Alice Corp ${run} Pvt Ltd`,
      entityType: 'PRIVATE_LIMITED',
    },
  });
  entityId = entity.id;
});

afterAll(async () => {
  for (const k of writtenKeys) {
    await storage.remove(k).catch(() => undefined);
  }
  const certs = await prisma.certificate.findMany({ where: { certificationBodyId: bodyId }, select: { id: true, pdfKey: true } });
  for (const c of certs) {
    if (c.pdfKey) await storage.remove(c.pdfKey).catch(() => undefined);
  }
  await prisma.certificateLookup.deleteMany({ where: { certificateId: { in: certs.map((c) => c.id) } } });
  await prisma.certificate.deleteMany({ where: { certificationBodyId: bodyId } });
  await prisma.certificationBody.deleteMany({ where: { id: bodyId } });
  await prisma.businessEntity.deleteMany({ where: { id: entityId } });
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.user.deleteMany({ where: users });
  await pdfQueueEvents.close();
  await app.close();
});

describe('Certificate PDF template + generation (M7.3)', () => {
  let certId: string;
  let certNum: string;
  let verId: string;
  let pdfKey: string;

  it('creating a certificate generates PDF via queue and attaches pdfKey', async () => {
    const res = await http
      .post('/api/admin/certificates')
      .set(as(admin))
      .send({
        type: 'ISO 9001:2015',
        organizationName: `Alice Corp ${run}`,
        scope: 'Software Design & Testing',
        issueDate: '2026-01-01',
        validFrom: '2026-01-01',
        validUntil: '2029-01-01',
        certificationBodyId: bodyId,
        businessEntityId: entityId,
        showPdfPublicly: false,
      })
      .expect(201);

    certId = res.body.id;
    certNum = res.body.certificateNumber;
    verId = res.body.verificationId;
    expect(certId).toBeDefined();

    // A row can get its key just before BullMQ completes and removes the active job ID; await the completion event
    // so the later regeneration request cannot be swallowed as a duplicate of this still-active job.
    const jobCompletion = waitForPdfJobCompletion(certId);
    pdfKey = await waitForGeneratedPdf(certId);
    await jobCompletion;
    expect(pdfKey).toBeDefined();
    writtenKeys.push(pdfKey);

    const bytes = await stored(pdfKey);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  }, 150_000);

  it('the customer owner gets a signed download link and streams the PDF', async () => {
    const link = (await http.post(`/api/certificates/${certId}/link`).set(as(alice)).expect(200)).body;
    expect(link.url).toMatch(new RegExp(`^/api/certificates/${certId}/download\\?`));

    const res = await http.get(link.url).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`attachment; filename="Certificate ${certNum.replace(/\//g, '-')}.pdf"`);
    expect(Buffer.compare(res.body as Buffer, await stored(pdfKey))).toBe(0);
  });

  it('another customer gets 404 when asking for a download link', async () => {
    await http.post(`/api/certificates/${certId}/link`).set(as(bob)).expect(404);
  });

  it('staff with certificates.manage can download the certificate', async () => {
    const link = (await http.post(`/api/certificates/${certId}/link`).set(as(admin)).expect(200)).body;
    const res = await http.get(link.url).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  it('refuses tampered, expired and re-targeted links', async () => {
    const { url } = (await http.post(`/api/certificates/${certId}/link`).set(as(alice)).expect(200)).body;
    await http.get(url.replace(/s=[^&]+/, 's=INVALID')).expect(403);
    await http.get(url.replace('d=attachment', 'd=inline')).expect(403);
    await http.get(signedPath(certId, Math.floor(Date.now() / 1000) - 1, 'attachment', 'certificates')).expect(403);
    // An invoice link for this certId cannot open the certificate (wrong scope in signature)
    await http.get(signedPath(certId, Math.floor(Date.now() / 1000) + 60, 'attachment', 'invoices').replace('/api/invoices/', '/api/certificates/')).expect(403);
  });

  it('public download: 403 when showPdfPublicly is false; 200 after toggle', async () => {
    await http.get(`/api/public/certificates/${verId}/download`).expect(403);
    await http.get(`/api/public/certificates/${certId}/download`).expect(403);

    // Toggle public download on
    const toggled = await http
      .patch(`/api/admin/certificates/${certId}/public-download`)
      .set(as(admin))
      .send({ showPdfPublicly: true })
      .expect(200);
    expect(toggled.body.showPdfPublicly).toBe(true);

    // Now public download succeeds
    const res = await http.get(`/api/public/certificates/${verId}/download`).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`attachment; filename="Certificate ${certNum.replace(/\//g, '-')}.pdf"`);

    // A suspended certificate's PDF is no longer public, even with the toggle on
    await prisma.certificate.update({ where: { id: certId }, data: { status: 'SUSPENDED' } });
    await http.get(`/api/public/certificates/${verId}/download`).expect(403);
    await prisma.certificate.update({ where: { id: certId }, data: { status: 'ACTIVE' } });
  });

  it('upload-your-own PDF attaches stored file key and does not overwrite it', async () => {
    // Simulate upload via M2.5.6 upload service
    const { newFileKey } = await import('../src/files/storage.service');
    const { Readable } = await import('node:stream');
    const customKey = newFileKey();
    const customBytes = Buffer.from('%PDF-1.4 Custom Uploaded Certificate Content');
    await storage.write(customKey, Readable.from(customBytes));
    writtenKeys.push(customKey);

    const storedFile = await prisma.storedFile.create({
      data: {
        fileKey: customKey,
        originalName: 'custom-official-cert.pdf',
        mimeType: 'application/pdf',
        sizeBytes: customBytes.length,
        sha256: 'abc123sha256fake',
        ownerId: aliceId,
        scanStatus: 'CLEAN',
      },
    });

    const attachRes = await http
      .post(`/api/admin/certificates/${certId}/pdf`)
      .set(as(admin))
      .send({ fileId: storedFile.id })
      .expect(201);
    expect(attachRes.body.pdfKey).toBe(customKey);

    // Downloading now gives the custom uploaded bytes
    const pubRes = await http.get(`/api/public/certificates/${verId}/download`).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(pubRes.body as Buffer, customBytes)).toBe(0);

    // Clean up stored file
    await prisma.storedFile.delete({ where: { id: storedFile.id } });
  });

  it('regenerate PDF from template re-renders and re-attaches official PDF', async () => {
    generatedPdfKeys.delete(certId);
    completedPdfJobIds.delete(`certificate-${certId}`);
    const jobCompletion = waitForPdfJobCompletion(certId);
    await http.post(`/api/admin/certificates/${certId}/pdf/regenerate`).set(as(admin)).expect(201);
    const newPdfKey = await waitForGeneratedPdf(certId);
    await jobCompletion;
    writtenKeys.push(newPdfKey);
    expect(newPdfKey).not.toBe(pdfKey);

    const bytes = await stored(newPdfKey);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // Ensure it is not the custom uploaded string
    expect(bytes.toString().includes('Custom Uploaded Certificate Content')).toBe(false);
  }, 150_000);
});
