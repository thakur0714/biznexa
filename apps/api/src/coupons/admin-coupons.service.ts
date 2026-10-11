import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  couponRuleIssues,
  couponStatus,
  type AdminCouponRow,
  type CouponServiceOption,
  type CreateCouponInput,
  type UpdateCouponInput,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';

const couponSelect = {
  id: true,
  code: true,
  type: true,
  value: true,
  maxDiscount: true,
  minOrderValue: true,
  serviceIds: true,
  startsAt: true,
  expiresAt: true,
  usageLimit: true,
  perUserLimit: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.CouponSelect;
type CouponRecord = Prisma.CouponGetPayload<{ select: typeof couponSelect }>;

interface UsageRow {
  couponId: string;
  redemptions: bigint;
  customers: bigint;
  discountGiven: bigint | null;
  lastUsedAt: Date | null;
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

/**
 * Admin coupon management (M3.12, D39). Usage comes from `CouponRedemption` (written when a payment
 * succeeds, M3.17), the same rows `CouponsService.validate` counts. Every write is audit logged.
 */
@Injectable()
export class AdminCouponsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Every coupon, newest first, with its usage. Three queries whatever the number of coupons. */
  async list(): Promise<AdminCouponRow[]> {
    const coupons = await this.prisma.coupon.findMany({ select: couponSelect, orderBy: { createdAt: 'desc' } });
    return this.withUsage(coupons);
  }

  async get(id: string): Promise<AdminCouponRow> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id }, select: couponSelect });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return (await this.withUsage([coupon]))[0];
  }

  async serviceOptions(): Promise<CouponServiceOption[]> {
    return this.prisma.service.findMany({ where: { deletedAt: null }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } });
  }

  async create(input: CreateCouponInput, actorId: string) {
    await this.checkCodeFree(input.code);
    await this.checkServices(input.serviceIds, []);
    const created = await this.prisma.coupon.create({
      data: { ...input, startsAt: toDate(input.startsAt), expiresAt: toDate(input.expiresAt) },
      select: couponSelect,
    });
    await this.audit.log({ actorId, action: 'coupon.create', entityType: 'Coupon', entityId: created.id, after: created });
    return this.get(created.id);
  }

  async update(id: string, input: UpdateCouponInput, actorId: string) {
    const before = await this.prisma.coupon.findUnique({ where: { id }, select: couponSelect });
    if (!before) throw new NotFoundException('Coupon not found');
    // Switching to a fixed amount drops the percentage cap unless the request sets one (which is then refused).
    if (input.type === 'FIXED' && input.maxDiscount === undefined) input = { ...input, maxDiscount: null };

    const merged = {
      type: input.type ?? before.type,
      value: input.value ?? before.value,
      maxDiscount: input.maxDiscount !== undefined ? input.maxDiscount : before.maxDiscount,
      startsAt: input.startsAt !== undefined ? input.startsAt : before.startsAt,
      expiresAt: input.expiresAt !== undefined ? input.expiresAt : before.expiresAt,
    };
    const issues = couponRuleIssues(merged);
    if (issues.length) throw new BadRequestException({ message: 'Please check the highlighted fields', errors: issues });

    if (input.code !== undefined && input.code !== before.code) {
      if (await this.inUse(id)) throw fieldError('code', 'Orders already use this code — create a new coupon instead', 409);
      await this.checkCodeFree(input.code);
    }
    if (input.serviceIds) await this.checkServices(input.serviceIds, before.serviceIds);

    const after = await this.prisma.coupon.update({
      where: { id },
      data: { ...input, startsAt: toDate(input.startsAt), expiresAt: toDate(input.expiresAt) },
      select: couponSelect,
    });
    await this.audit.log({ actorId, action: 'coupon.update', entityType: 'Coupon', entityId: id, before, after });
    return this.get(id);
  }

  /** Only a coupon no order has used can be deleted; others are deactivated so orders and reports keep it. */
  async remove(id: string, actorId: string) {
    const before = await this.prisma.coupon.findUnique({ where: { id }, select: couponSelect });
    if (!before) throw new NotFoundException('Coupon not found');
    if (await this.inUse(id)) throw new ConflictException('Orders already use this coupon — deactivate it instead');
    await this.prisma.coupon.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'coupon.delete', entityType: 'Coupon', entityId: id, before });
    return { message: 'Coupon deleted' };
  }

  private async inUse(id: string) {
    const [orders, redemptions] = await Promise.all([
      this.prisma.order.count({ where: { couponId: id } }),
      this.prisma.couponRedemption.count({ where: { couponId: id } }),
    ]);
    return orders + redemptions > 0;
  }

  private async checkCodeFree(code: string) {
    const taken = await this.prisma.coupon.findUnique({ where: { code }, select: { id: true } });
    if (taken) throw fieldError('code', 'Another coupon already uses this code', 409);
  }

  /** New service ids must be catalogue services; ids the coupon already had may since have been deleted. */
  private async checkServices(ids: string[], existing: string[]) {
    const added = ids.filter((id) => !existing.includes(id));
    if (!added.length) return;
    const found = await this.prisma.service.count({ where: { id: { in: added }, deletedAt: null } });
    if (found !== added.length) throw fieldError('serviceIds', 'Pick services from the catalogue');
  }

  private async withUsage(coupons: CouponRecord[]): Promise<AdminCouponRow[]> {
    if (!coupons.length) return [];
    const ids = coupons.map((c) => c.id);
    const serviceIds = [...new Set(coupons.flatMap((c) => c.serviceIds))];
    const [usage, orders, services] = await Promise.all([
      this.prisma.$queryRaw<UsageRow[]>`
        SELECT "couponId", COUNT(*) AS redemptions, COUNT(DISTINCT "userId") AS customers,
               SUM(amount) AS "discountGiven", MAX("createdAt") AS "lastUsedAt"
        FROM "CouponRedemption" WHERE "couponId" IN (${Prisma.join(ids)}) GROUP BY "couponId"`,
      this.prisma.order.groupBy({ by: ['couponId'], where: { couponId: { in: ids } }, _count: { _all: true } }),
      serviceIds.length
        ? this.prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true, deletedAt: true } })
        : Promise.resolve([]),
    ]);
    const usageBy = new Map(usage.map((u) => [u.couponId, u]));
    const ordersBy = new Map(orders.map((o) => [o.couponId, o._count._all]));
    const serviceBy = new Map(services.map((s) => [s.id, s]));
    const now = new Date();

    return coupons.map((c) => {
      const u = usageBy.get(c.id);
      const redemptions = Number(u?.redemptions ?? 0);
      return {
        ...c,
        startsAt: c.startsAt?.toISOString() ?? null,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        services: c.serviceIds.map((id) => {
          const s = serviceBy.get(id);
          return { id, name: s?.name ?? 'Unknown service', removed: !s || s.deletedAt !== null };
        }),
        status: couponStatus(c, redemptions, now),
        usage: {
          redemptions,
          customers: Number(u?.customers ?? 0),
          discountGiven: Number(u?.discountGiven ?? 0),
          lastUsedAt: u?.lastUsedAt?.toISOString() ?? null,
        },
        inUse: redemptions + (ordersBy.get(c.id) ?? 0) > 0,
      };
    });
  }
}

function fieldError(field: string, message: string, status: 400 | 409 = 400) {
  const body = { message, errors: [{ field, message }] };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}
