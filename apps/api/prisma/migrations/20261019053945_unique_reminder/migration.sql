-- One reminder per type + source, so a replayed event can't create a second one.
ALTER TABLE "Reminder" ADD COLUMN "sourceKey" TEXT;

-- Backfill: renewals by application, certificate expiries by certificate (matched on the
-- number in the title), anything else keeps its own id so it never collides.
UPDATE "Reminder" SET "sourceKey" = 'application:' || "sourceApplicationId"
WHERE "type" = 'SERVICE_RENEWAL' AND "sourceApplicationId" IS NOT NULL;

UPDATE "Reminder" r SET "sourceKey" = 'certificate:' || c."id"
FROM "Certificate" c
WHERE r."type" = 'CERTIFICATE_EXPIRY'
  AND r."title" = c."type" || ' certificate ' || c."certificateNumber" || ' expires';

UPDATE "Reminder" SET "sourceKey" = "id" WHERE "sourceKey" IS NULL;

-- Drop duplicates, keeping the oldest row (id breaks ties).
DELETE FROM "Reminder" a
USING "Reminder" b
WHERE a."type" = b."type"
  AND a."sourceKey" = b."sourceKey"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

ALTER TABLE "Reminder" ALTER COLUMN "sourceKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_type_sourceKey_key" ON "Reminder"("type", "sourceKey");
