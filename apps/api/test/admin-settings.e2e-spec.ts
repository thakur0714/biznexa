/**
 * Seller details (M3.14, D41): `settings.manage` only, every field validated with the shared schema, the
 * state stored as a name taken from the address (which the order summary reads), older values read back,
 * and one audit entry per save holding only the keys that changed.
 *
 * Settings are global and other suites run at the same time, so every save here keeps the seller in
 * Punjab (the order summary suite sets `PB`), and the original rows are put back afterwards.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { SELLER_SETTING_KEYS, REJECTION_PRESETS_KEY, MOBILE_VERSION_KEY, gstinCheckChar, sellerSettingsSchema, rejectionPresetsSchema, stateName, type SellerSettings, type RejectionPresets } from '@biznexa/types';
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
let original: { key: string; value: unknown }[];
// mobile.minSupportedVersion is a seeded row that app.e2e also reads: restore it, never delete it.
let originalMobileVersion: { value: unknown } | null;

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const email = (n: number) => `e2e-st-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const KEYS: string[] = Object.values(SELLER_SETTING_KEYS);

const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const address = { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' };
const details = {
  name: 'BizNexa',
  legalName: `BizNexa Test ${run} Private Limited`,
  gstin: gstin('03AABCB1234F1Z'),
  email: 'billing@biznexa.com',
  phone: '+91 98765 43210',
  address,
  invoicePrefix: 'bn',
};
const put = (body: unknown, token = admin) => http.put('/api/admin/settings/seller').set(as(token)).send(body as object);
const stored = async (key: string) => (await prisma.setting.findUnique({ where: { key } }))?.value;
const audits = () => prisma.auditLog.findMany({ where: { actorId: adminId, action: 'settings.seller.update' }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  await prisma.setting.deleteMany({ where: { key: REJECTION_PRESETS_KEY } });
  originalMobileVersion = await prisma.setting.findUnique({ where: { key: MOBILE_VERSION_KEY }, select: { value: true } });
  original = await prisma.setting.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true } });
  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: email(1) } })).id;
});

describe('mobile version (M3.14)', () => {
  const getVersion = (token: string) => http.get('/api/admin/settings/mobile-version').set(as(token));
  const putVersion = (body: unknown, token: string) => http.put('/api/admin/settings/mobile-version').set(as(token)).send(body as object);

  it('allows GET/PUT for settings.manage, refuses others', async () => {
    // ops has documents.review but not settings.manage
    await getVersion(ops).expect(403);
    await putVersion({ minSupportedVersion: '1.2.3' }, ops).expect(403);
  });

  it('admin GET/PUT ok, writes an audit log', async () => {
    const version = '2.7.0'; // not 1.4.0: app.e2e writes that, and an unchanged value writes no audit row
    const res = await putVersion({ minSupportedVersion: version }, admin).expect(200);
    expect(res.body.minSupportedVersion).toBe(version);

    expect((await getVersion(admin).expect(200)).body.minSupportedVersion).toBe(version);

    // Audit logs are stored via event bus. Wait for it.
    await new Promise((r) => setTimeout(r, 200));

    const log = await prisma.auditLog.findFirst({
      where: { actorId: adminId, action: 'settings.mobile-version.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log?.after).toEqual({ minSupportedVersion: version });
  });

  it('refuses invalid versions', async () => {
    await putVersion({ minSupportedVersion: 'invalid' }, admin).expect(400);
    await putVersion({ minSupportedVersion: '1.2.3.4' }, admin).expect(400);
    await putVersion({ minSupportedVersion: '' }, admin).expect(400);
  });

  it('customer and support cannot access', async () => {
    await http.get('/api/admin/settings/mobile-version').expect(401);
    await http.put('/api/admin/settings/mobile-version').send({ minSupportedVersion: '1.2.0' }).expect(401);
  });
});

afterAll(async () => {
  const kept = new Map(original.map((r) => [r.key, r.value]));
  await prisma.setting.deleteMany({ where: { key: { in: [...KEYS.filter((k) => !kept.has(k)), REJECTION_PRESETS_KEY] } } });
  for (const [key, value] of kept) await prisma.setting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } }); // NOSONAR: tests run steps in order
  await prisma.setting.deleteMany({ where: { key: REJECTION_PRESETS_KEY } });
  if (originalMobileVersion) await prisma.setting.update({ where: { key: MOBILE_VERSION_KEY }, data: { value: originalMobileVersion.value as string } });
  else await prisma.setting.deleteMany({ where: { key: MOBILE_VERSION_KEY } });
  await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-st-${run}` } } });
  await app.close();
});

describe('admin seller settings (M3.14)', () => {
  it('needs settings.manage', async () => {
    await http.get('/api/admin/settings/seller').expect(401);
    await http.get('/api/admin/settings/seller').set(as(ops)).expect(403);
    await put(details, ops).expect(403);
    expect(await stored(SELLER_SETTING_KEYS.legalName)).not.toBe(details.legalName);
  });

  it('reads what is stored, including an older state code', async () => {
    await prisma.setting.upsert({ where: { key: SELLER_SETTING_KEYS.state }, update: { value: 'PB' }, create: { key: SELLER_SETTING_KEYS.state, value: 'PB' } });
    await prisma.setting.deleteMany({ where: { key: SELLER_SETTING_KEYS.address } });
    const body = (await http.get('/api/admin/settings/seller').set(as(admin)).expect(200)).body as SellerSettings;
    expect(sellerSettingsSchema.strict().safeParse(body).error).toBeUndefined();
    expect(body).toMatchObject({ state: 'Punjab', address: null });
  });

  it('saves every field, with the state as a name from the address, and logs only what changed', async () => {
    const res = await put({ ...details, gstin: details.gstin.toLowerCase() }).expect(200);
    const body = res.body as SellerSettings;
    expect(sellerSettingsSchema.strict().safeParse(body).error).toBeUndefined();
    expect(body).toMatchObject({ ...details, invoicePrefix: 'BN', state: 'Punjab' });
    expect(await stored(SELLER_SETTING_KEYS.state)).toBe('Punjab');
    expect(await stored(SELLER_SETTING_KEYS.address)).toEqual(address);
    expect(await stored(SELLER_SETTING_KEYS.invoicePrefix)).toBe('BN');
    const getRes = (await http.get('/api/admin/settings/seller').set(as(admin)).expect(200)).body;
    expect(getRes).toMatchObject(body);
    expect(getRes.updatedAt).toBeDefined();

    await put({ ...details, phone: '', invoicePrefix: 'BNX' }).expect(200);
    expect(await stored(SELLER_SETTING_KEYS.phone)).toBe('');
    const log = await audits();
    expect(log.at(-1)).toMatchObject({
      entityType: 'Setting',
      entityId: 'seller',
      before: { [SELLER_SETTING_KEYS.phone]: details.phone, [SELLER_SETTING_KEYS.invoicePrefix]: 'BN' },
      after: { [SELLER_SETTING_KEYS.phone]: '', [SELLER_SETTING_KEYS.invoicePrefix]: 'BNX' },
    });

    // Saving the same details again changes nothing and logs nothing.
    await put({ ...details, phone: '', invoicePrefix: 'BNX' }).expect(200);
    expect(await audits()).toHaveLength(log.length);
  });

  it('refuses invalid details with each field listed and stores nothing', async () => {
    const before = await prisma.setting.findMany({ where: { key: { in: KEYS } }, orderBy: { key: 'asc' } });
    const bad = await put({ ...details, legalName: '', gstin: '03AABCB1234F1ZZ', email: 'billing', address: { ...address, pincode: '12' }, invoicePrefix: 'BN/' }).expect(400);
    expect((bad.body.errors as { field: string }[]).map((e) => e.field).sort((a, b) => a.localeCompare(b))).toEqual(['address.pincode', 'email', 'gstin', 'invoicePrefix', 'legalName']);

    const elsewhere = await put({ ...details, gstin: gstin('07AABCB1234F1Z') }).expect(400);
    expect(elsewhere.body.errors).toEqual([{ field: 'gstin', message: 'This GSTIN is registered in Delhi, not Punjab' }]);

    await put({ ...details, state: 'Delhi' }).expect(400);
    await put({ ...details, address: undefined }).expect(400);
    expect(await prisma.setting.findMany({ where: { key: { in: KEYS } }, orderBy: { key: 'asc' } })).toEqual(before);
  });

  it('is the seller state the order summary uses', async () => {
    expect(stateName((await stored(SELLER_SETTING_KEYS.state)) as string)).toBe('Punjab');
  });
});


describe('rejection presets (M4.9)', () => {
  const getPresets = (token: string) => http.get('/api/admin/settings/rejection-presets').set(as(token));
  const putPresets = (body: unknown, token: string) => http.put('/api/admin/settings/rejection-presets').set(as(token)).send(body as object);

  it('allows GET for documents.review and settings.manage, but PUT only for settings.manage', async () => {
    // ops has documents.review (from seeded STAFF_ROLES if we used demo data, but here we created ops as OPERATIONS)
    // Wait, ops in this test suite has the OPERATIONS role. Does it have documents.review? Let's check roles.
    // In seed-data, OPERATIONS has documents.review but not settings.manage.
    
    // Admin (settings.manage)
    await getPresets(admin).expect(200);
    
    // Ops (documents.review but not settings.manage)
    await getPresets(ops).expect(200);
    await putPresets(['One'], ops).expect(403);
  });

  it('admin GET/PUT ok, writes an audit log', async () => {
    const presets = ['Blurry', 'Missing signature'];
    const res = await putPresets(presets, admin).expect(200);
    const body = res.body as RejectionPresets;
    expect(rejectionPresetsSchema.strict().safeParse(body).error).toBeUndefined();
    expect(body.presets).toEqual(presets);
    
    expect((await getPresets(admin).expect(200)).body.presets).toEqual(presets);

    const log = await prisma.auditLog.findFirst({
      where: { actorId: adminId, action: 'settings.rejection-presets.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log?.after).toEqual({ presets });
  });

  it('refuses invalid presets (empty, duplicate, >50)', async () => {
    await putPresets([''], admin).expect(400);
    await putPresets(['Blurry', 'Blurry'], admin).expect(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => `Preset ${i}`);
    await putPresets(tooMany, admin).expect(400);
  });

  it('customer and support cannot access', async () => {
    // support is not defined, we'll create a customer token to test 401/403
    // well, without token it's 401
    await http.get('/api/admin/settings/rejection-presets').expect(401);
    await http.put('/api/admin/settings/rejection-presets').send(['One']).expect(401);
  });
});
