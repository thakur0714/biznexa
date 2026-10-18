CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Review"
  ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "moderationReason" TEXT,
  ADD COLUMN "moderatedAt" TIMESTAMP(3),
  ADD COLUMN "moderatedById" TEXT;

UPDATE "Review" SET "status" = 'APPROVED' WHERE "isPublished" = true;
ALTER TABLE "Review" ALTER COLUMN "isPublished" SET DEFAULT false;
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range_check" CHECK ("rating" BETWEEN 1 AND 5);

CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");
CREATE INDEX "Review_consultantId_status_idx" ON "Review"("consultantId", "status");
ALTER TABLE "Review" ADD CONSTRAINT "Review_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
