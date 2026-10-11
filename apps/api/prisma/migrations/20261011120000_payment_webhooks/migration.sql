-- M3.17: payment webhooks are stored as received; (gateway, eventId) is claimed in the same transaction
-- that applies the event, so a redelivery changes nothing. One coupon redemption per order backs up the
-- order row lock in PaymentWebhookService (nothing has written CouponRedemption before this step).
-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "gatewayPaymentId" TEXT,
    "paymentId" TEXT,
    "payload" JSONB NOT NULL,
    "outcome" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_paymentId_idx" ON "PaymentWebhookEvent"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_gateway_eventId_key" ON "PaymentWebhookEvent"("gateway", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_orderId_key" ON "CouponRedemption"("orderId");

-- AddForeignKey
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

