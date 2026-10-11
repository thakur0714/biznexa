/**
 * Coupon validation against the real database (M3.11): code lookup (case/space-insensitive), every rule
 * from `evaluateCoupon`, and usage limits counted from `CouponRedemption` rows — total across customers,
 * per-customer for the one checking out.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CouponsService } from '../src/coupons/coupons.service';
import { Prisma } from '../src/generated/prisma/client';

let prisma: PrismaService;
let coupons: CouponsService;
let close: () => Promise<void>;
let alice: string;
let bob: string;

const run = Date.now().toString().slice(-7);
const prefix = `E2E${run}`;
const users = { email: { startsWith: `e2e-coupons-${run}` } };
const gst = randomUUID();
const company = randomUUID();
const order = [{ serviceId: gst, professionalFee: 100000 }]; // ₹1,000
const now = new Date('2026-10-11T06:30:00.000Z');
const day = 24 * 60 * 60 * 1000;

let n = 0;
async function coupon(data: Partial<Prisma.CouponCreateInput> = {}) {
  const code = `${prefix}-${++n}`;
  return prisma.coupon.create({ data: { code, type: 'PERCENTAGE', value: 10, ...data }, select: { id: true, code: true } });
}
const redeem = (couponId: string, userId: string) =>
  prisma.couponRedemption.create({ data: { couponId, userId, orderId: randomUUID(), amount: 1000 } });
const check = (code: string, userId = alice, lines = order) => coupons.validate({ code, userId, lines, now });
const reason = async (code: string, userId = alice, lines = order) => {
  const r = await check(code, userId, lines);
  return r.ok ? 'OK' : r.reason;
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  close = () => app.close();
  prisma = app.get(PrismaService);
  coupons = app.get(CouponsService);
  const user = (i: number) =>
    prisma.user.create({ data: { name: 'Coupon Test', email: `e2e-coupons-${run}-${i}@example.com` }, select: { id: true } }).then((u) => u.id);
  [alice, bob] = await Promise.all([user(1), user(2)]);
});

afterAll(async () => {
  const mine = { coupon: { code: { startsWith: prefix } } };
  await prisma.couponRedemption.deleteMany({ where: mine });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: users });
  await close();
});

describe('coupon validation (M3.11)', () => {
  it('finds a coupon whatever the case or surrounding spaces', async () => {
    const c = await coupon();
    expect(await check(`  ${c.code.toLowerCase()} `)).toEqual({ ok: true, couponId: c.id, code: c.code, discount: 10000, eligibleAmount: 100000, lineDiscounts: [10000] });
  });

  it('refuses unknown and malformed codes the same way, without a query error', async () => {
    const unknown = await check(`${prefix}-NOPE`);
    expect(unknown).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    expect(await check("x' OR 1=1 --")).toEqual(unknown);
    expect(await check('')).toEqual(unknown);
  });

  it('refuses an inactive coupon', async () => {
    const c = await coupon({ isActive: false });
    expect(await check(c.code)).toMatchObject({ ok: false, reason: 'INACTIVE', message: 'This coupon code is not valid.' });
  });

  it('honours the start and expiry dates', async () => {
    expect(await reason((await coupon({ startsAt: new Date(now.getTime() + day) })).code)).toBe('NOT_STARTED');
    expect(await reason((await coupon({ expiresAt: new Date(now.getTime() - day) })).code)).toBe('EXPIRED');
    expect(await reason((await coupon({ startsAt: new Date(now.getTime() - day), expiresAt: new Date(now.getTime() + day) })).code)).toBe('OK');
  });

  it('applies only to the services it names', async () => {
    const c = await coupon({ serviceIds: [company] });
    expect(await reason(c.code)).toBe('SERVICE_MISMATCH');
    expect(await reason(c.code, alice, [{ serviceId: company, professionalFee: 200000 }])).toBe('OK');
  });

  it('checks the minimum order value', async () => {
    const c = await coupon({ minOrderValue: 150000 });
    expect(await check(c.code)).toMatchObject({ ok: false, reason: 'MIN_ORDER', minOrderValue: 150000 });
    expect(await reason(c.code, alice, [{ serviceId: gst, professionalFee: 150000 }])).toBe('OK');
  });

  it('caps the discount at maxDiscount and never above the fee', async () => {
    expect(await check((await coupon({ value: 50, maxDiscount: 25000 })).code)).toMatchObject({ ok: true, discount: 25000 });
    expect(await check((await coupon({ type: 'FIXED', value: 300000 })).code)).toMatchObject({ ok: true, discount: 100000 });
  });

  it('counts every customer’s redemptions towards the total limit', async () => {
    const c = await coupon({ usageLimit: 2, perUserLimit: null });
    await redeem(c.id, bob);
    expect(await reason(c.code)).toBe('OK');
    await redeem(c.id, bob);
    expect(await reason(c.code)).toBe('USAGE_LIMIT');
    expect(await reason(c.code, bob)).toBe('USAGE_LIMIT');
  });

  it('counts only this customer’s redemptions towards the per-customer limit', async () => {
    const c = await coupon(); // perUserLimit defaults to 1
    await redeem(c.id, bob);
    expect(await reason(c.code, bob)).toBe('PER_USER_LIMIT');
    expect(await reason(c.code, alice)).toBe('OK');

    const twice = await coupon({ perUserLimit: 2 });
    await redeem(twice.id, alice);
    expect(await reason(twice.code)).toBe('OK');
    await redeem(twice.id, alice);
    expect(await reason(twice.code)).toBe('PER_USER_LIMIT');
  });

  it('has no limit when the limits are empty', async () => {
    const c = await coupon({ usageLimit: null, perUserLimit: null });
    await Promise.all([redeem(c.id, alice), redeem(c.id, alice), redeem(c.id, bob)]);
    expect(await reason(c.code)).toBe('OK');
  });

  it('does not count unpaid orders that hold the coupon', async () => {
    const c = await coupon({ usageLimit: 1 });
    await prisma.order.create({ data: { code: `ORD-${prefix}`, customerId: bob, subtotal: 100000, total: 118000, couponId: c.id } });
    try {
      expect(await reason(c.code)).toBe('OK');
    } finally {
      await prisma.order.deleteMany({ where: { code: `ORD-${prefix}` } });
    }
  });

  it('runs inside a caller’s transaction and sees its uncommitted redemption', async () => {
    const c = await coupon({ usageLimit: 1, perUserLimit: null });
    await prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id = ${c.id} FOR UPDATE`;
        expect((await coupons.validate({ code: c.code, userId: alice, lines: order, now }, tx)).ok).toBe(true);
        await tx.couponRedemption.create({ data: { couponId: c.id, userId: bob, orderId: randomUUID(), amount: 1000 } });
        expect(await coupons.validate({ code: c.code, userId: alice, lines: order, now }, tx)).toMatchObject({ reason: 'USAGE_LIMIT' });
        throw new Error('rollback');
      })
      .catch((e: Error) => expect(e.message).toBe('rollback'));
    expect(await reason(c.code)).toBe('OK');
  });
});
