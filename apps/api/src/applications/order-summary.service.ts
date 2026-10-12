import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SELLER_SETTING_KEYS, advancePayment, orderTotals, placeOfSupply, stateName, type OrderLineInput, type OrderSummary } from '@biznexa/types';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

/** The Setting holding the seller's state (admin Settings page, M3.14): a name, or an older `PB` / `03`. */
export const SELLER_STATE_KEY = SELLER_SETTING_KEYS.state;

const orderSelect = {
  id: true,
  code: true,
  status: true,
  customerId: true,
  buyerState: true,
  discount: true,
  total: true,
  amountPaid: true,
  coupon: { select: { code: true } },
  items: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      description: true,
      sacCode: true,
      professionalFee: true,
      governmentFee: true,
      gstRate: true,
      discount: true,
      advancePercent: true,
      package: {
        select: {
          name: true,
          professionalFee: true,
          governmentFee: true,
          gstRate: true,
          allowPartial: true,
          advancePercent: true,
          isActive: true,
          service: { select: { id: true, name: true, sacCode: true, isActive: true, deletedAt: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

/** What the customer asked to change: a new coupon code, or `null` to remove it. Absent = just show the summary. */
type CouponChange = { code: string | null } | undefined;

/**
 * Order summary & totals (M3.13, D40). Every call recomputes the order from the **current** package
 * prices, the coupon (re-validated) and the place of supply, and stores the result on the order and its
 * lines, under a lock on the order row. Nothing the client sends is an amount: the only input is a coupon
 * code. Once payment has started (order not `CREATED` or application not `DRAFT`) the stored totals are
 * frozen and shown as they are. M3.16 should call `price` inside its own transaction before creating the
 * gateway order, so the amount charged is always the one computed here.
 */
@Injectable()
export class OrderSummaryService {
  private readonly log = new Logger(OrderSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponsService,
  ) {}

  /** The summary page: refreshes totals (and drops a coupon that no longer applies). */
  summary(customerId: string, applicationId: string): Promise<OrderSummary> {
    return this.prisma.$transaction((tx) => this.price(tx, customerId, applicationId));
  }

  /** Applies a coupon code; an invalid one is a 400 on `code` and changes nothing. */
  applyCoupon(customerId: string, applicationId: string, code: string): Promise<OrderSummary> {
    return this.prisma.$transaction((tx) => this.price(tx, customerId, applicationId, { code }));
  }

  removeCoupon(customerId: string, applicationId: string): Promise<OrderSummary> {
    return this.prisma.$transaction((tx) => this.price(tx, customerId, applicationId, { code: null }));
  }

  /** Recomputes and stores the order's totals inside `tx`; see the class comment. */
  async price(tx: Prisma.TransactionClient, customerId: string, applicationId: string, change?: CouponChange): Promise<OrderSummary> {
    const app = await tx.application.findFirst({
      where: { id: applicationId, customerId },
      select: { id: true, code: true, status: true, orderId: true, businessEntityId: true },
    });
    if (!app?.orderId) throw new NotFoundException('Application not found');

    // Serialises summaries, coupon changes and (M3.16) payment start for this order.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${app.orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: app.orderId }, select: orderSelect });
    const head = { applicationId: app.id, applicationCode: app.code, orderId: order.id, orderCode: order.code, orderStatus: order.status };

    const sellerState = await this.sellerState(tx);

    if (order.status !== 'CREATED' || app.status !== 'DRAFT') {
      if (change) throw new ConflictException('Payment for this order has started, so its coupon can’t be changed.');
      return frozenSummary(head, order, sellerState, !!app.businessEntityId);
    }

    for (const item of order.items) {
      const p = item.package;
      if (!p.isActive || !p.service.isActive || p.service.deletedAt) {
        throw new ConflictException(`${item.description} is no longer offered, so this order can’t be paid. Start again from the service page.`);
      }
    }
    const base = order.items.map((i) => ({
      id: i.id,
      description: `${i.package.service.name} — ${i.package.name}`,
      sacCode: i.package.service.sacCode,
      serviceId: i.package.service.id,
      professionalFee: i.package.professionalFee,
      governmentFee: i.package.governmentFee,
      gstRate: i.package.gstRate,
      // Snapshotted with the prices (D40), so the advance can't change once payment has started (M3.19).
      advancePercent: i.package.allowPartial ? i.package.advancePercent : null,
    }));

    const supply = placeOfSupply({ ...(await this.buyerStates(tx, customerId, app.businessEntityId)), seller: sellerState });

    const code = change ? change.code : (order.coupon?.code ?? null);
    let couponNotice: string | null = null;
    let coupon: { id: string; code: string; discount: number } | null = null;
    let lineDiscounts = base.map(() => 0);
    if (code) {
      const result = await this.coupons.validate(
        { code, userId: customerId, lines: base.map((l) => ({ serviceId: l.serviceId, professionalFee: l.professionalFee })) },
        tx,
      );
      if (result.ok) {
        coupon = { id: result.couponId, code: result.code, discount: result.discount };
        lineDiscounts = result.lineDiscounts;
      } else if (change) {
        throw new BadRequestException({ message: result.message, errors: [{ field: 'code', message: result.message }] });
      } else {
        couponNotice = `Coupon ${code} was removed: ${result.message}`;
      }
    }

    const lines: OrderLineInput[] = base.map((l, i) => ({ ...l, discount: lineDiscounts[i] }));
    const totals = orderTotals(lines, { sellerState, placeOfSupply: supply?.state ?? null });

    await tx.order.update({
      where: { id: order.id },
      data: {
        subtotal: totals.professionalFee,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        govtFees: totals.governmentFee,
        total: totals.total,
        couponId: coupon?.id ?? null,
        // The buyer's own state when known; the seller fallback is not the buyer's state.
        buyerState: supply && supply.source !== 'SELLER' ? supply.state : null,
      },
    });
    for (const [i, l] of base.entries()) {
      await tx.orderItem.update({
        where: { id: l.id },
        data: {
          description: l.description,
          sacCode: l.sacCode,
          professionalFee: l.professionalFee,
          governmentFee: l.governmentFee,
          gstRate: l.gstRate,
          discount: lineDiscounts[i],
          advancePercent: l.advancePercent,
        },
      });
    }

    return toSummary(head, true, base, totals, coupon && { code: coupon.code, discount: coupon.discount }, couponNotice, supply, 0);
  }

  private async sellerState(tx: Prisma.TransactionClient): Promise<string | null> {
    const row = await tx.setting.findUnique({ where: { key: SELLER_STATE_KEY }, select: { value: true } });
    const state = typeof row?.value === 'string' ? stateName(row.value) : null;
    if (!state) this.log.warn(`Setting ${SELLER_STATE_KEY} is missing or not a state; GST is charged as IGST until it is set`);
    return state;
  }

  /** The business on the order (if still the customer's) and the customer's profile state. */
  private async buyerStates(tx: Prisma.TransactionClient, customerId: string, businessEntityId: string | null) {
    const [business, profile] = await Promise.all([
      businessEntityId
        ? tx.businessEntity.findFirst({ where: { id: businessEntityId, ownerId: customerId, deletedAt: null }, select: { state: true } })
        : null,
      tx.customerProfile.findUnique({ where: { userId: customerId }, select: { state: true } }),
    ]);
    return { business: business?.state ?? null, profile: profile?.state ?? null };
  }
}

type Head = Pick<OrderSummary, 'applicationId' | 'applicationCode' | 'orderId' | 'orderCode' | 'orderStatus'>;
type Line = Pick<OrderSummary['lines'][number], 'description' | 'sacCode'> & { advancePercent: number | null };

function toSummary(
  head: Head,
  editable: boolean,
  lines: Line[],
  totals: ReturnType<typeof orderTotals>,
  coupon: OrderSummary['coupon'],
  couponNotice: string | null,
  supply: OrderSummary['placeOfSupply'],
  amountPaid: number,
): OrderSummary {
  // Part payment is a choice made before anything is paid; afterwards only the balance is left.
  const advance = amountPaid > 0 ? null : advancePayment(lines.map((l, i) => ({ total: totals.lines[i].total, governmentFee: totals.lines[i].governmentFee, advancePercent: l.advancePercent })));
  return {
    ...head,
    editable,
    lines: lines.map((l, i) => {
      const p = totals.lines[i];
      return {
        description: l.description,
        sacCode: l.sacCode,
        professionalFee: p.professionalFee,
        discount: p.discount,
        taxableValue: p.taxableValue,
        gstRate: p.gstRate,
        cgst: p.cgst,
        sgst: p.sgst,
        igst: p.igst,
        governmentFee: p.governmentFee,
        total: p.total,
      };
    }),
    coupon,
    couponNotice,
    placeOfSupply: supply,
    taxType: totals.taxType,
    professionalFee: totals.professionalFee,
    discount: totals.discount,
    taxableValue: totals.taxableValue,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    taxTotal: totals.taxTotal,
    governmentFee: totals.governmentFee,
    total: totals.total,
    amountPaid,
    balance: totals.total - amountPaid,
    advance,
  };
}

/**
 * After payment has started: the stored line snapshots as they are, split by the stored buyer state
 * (which came from the business when the application has one, else from the profile).
 */
function frozenSummary(head: Head, order: OrderRow, sellerState: string | null, hasBusiness: boolean): OrderSummary {
  const buyer = stateName(order.buyerState);
  const seller = stateName(sellerState);
  const supply: OrderSummary['placeOfSupply'] = buyer
    ? { state: buyer, source: hasBusiness ? 'BUSINESS' : 'PROFILE' }
    : seller
      ? { state: seller, source: 'SELLER' }
      : null;
  const totals = orderTotals(order.items, { sellerState, placeOfSupply: supply?.state ?? null });
  return toSummary(head, false, order.items, totals, order.coupon && { code: order.coupon.code, discount: order.discount }, null, supply, order.amountPaid);
}
