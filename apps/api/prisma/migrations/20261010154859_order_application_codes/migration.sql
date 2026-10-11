-- Running numbers for human-readable codes (M3.8, D35). nextval() never hands the same number to two
-- transactions, so concurrent checkouts cannot get the same code. Numbers used by a rolled-back request
-- are skipped (codes are unique, not gap-free). Formatting lives in packages/types (formatOrderCode,
-- formatApplicationCode). Prisma does not model sequences; the services call nextval() directly.

-- ORD-YYYY-000001 …
CREATE SEQUENCE "order_code_seq" AS BIGINT START WITH 1;

-- BN10001 … (FIRST_APPLICATION_NUMBER)
CREATE SEQUENCE "application_code_seq" AS BIGINT START WITH 10001;
