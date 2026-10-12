-- M3.19: the package's advance % is copied onto each order line with its prices while the order is a
-- draft (D40), so the advance offered after payment has started can't change under the customer.
-- NULL = the line can't be paid in part.
-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "advancePercent" INTEGER;
