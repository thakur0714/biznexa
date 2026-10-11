import { Injectable } from '@nestjs/common';
import { couponCodeSchema, evaluateCoupon, type CouponEvaluation, type CouponOrderLine } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
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
} satisfies Prisma.CouponSelect;

export interface ValidateCouponInput {
  /** As the customer typed it; trimmed and upper-cased here. */
  code: string;
  userId: string;
  lines: CouponOrderLine[];
  now?: Date;
}

/**
 * Server-side coupon checks (M3.11, D38). The rules live in `evaluateCoupon` (`packages/types`); this
 * loads the coupon and counts its redemptions. Limits count `CouponRedemption` rows, which are written
 * only when a payment succeeds (M3.17), so unpaid orders holding the coupon do not use it up.
 */
@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the discount or the reason the coupon was refused; never throws for a bad code. Pass `db`
   * to run inside a transaction (payment steps re-check under a lock on the coupon row).
   */
  async validate(input: ValidateCouponInput, db: Prisma.TransactionClient = this.prisma): Promise<CouponEvaluation> {
    const now = input.now ?? new Date();
    const code = couponCodeSchema.safeParse(input.code);
    if (!code.success) return evaluateCoupon(null, { lines: input.lines, timesUsed: 0, timesUsedByUser: 0, now });

    const coupon = await db.coupon.findUnique({ where: { code: code.data }, select: couponSelect });
    if (!coupon) return evaluateCoupon(null, { lines: input.lines, timesUsed: 0, timesUsedByUser: 0, now });

    const [timesUsed, timesUsedByUser] = await Promise.all([
      coupon.usageLimit == null ? 0 : db.couponRedemption.count({ where: { couponId: coupon.id } }),
      coupon.perUserLimit == null ? 0 : db.couponRedemption.count({ where: { couponId: coupon.id, userId: input.userId } }),
    ]);
    return evaluateCoupon(coupon, { lines: input.lines, timesUsed, timesUsedByUser, now });
  }
}
