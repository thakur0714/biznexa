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
import { SELLER_SETTING_KEYS, gstinCheckChar, sellerSettingsSchema, stateName, type SellerSettings } from '@biznexa/types';
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
  original = await prisma.setting.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true } });
  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: email(1) } })).id;
});

afterAll(async () => {
  const kept = new Map(original.map((r) => [r.key, r.value]));
  await prisma.setting.deleteMany({ where: { key: { in: KEYS.filter((k) => !kept.has(k)) } } });
  for (const [key, value] of kept) await prisma.setting.update({ where: { key }, data: { value: value as object } });
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
    expect((await http.get('/api/admin/settings/seller').set(as(admin)).expect(200)).body).toEqual(body);

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
    expect((bad.body.errors as { field: string }[]).map((e) => e.field).sort()).toEqual(['address.pincode', 'email', 'gstin', 'invoicePrefix', 'legalName']);

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
