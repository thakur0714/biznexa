-- AlterTable
ALTER TABLE "ApplicationDocument" ADD COLUMN     "description" TEXT,
ADD COLUMN     "requestId" TEXT;

-- Additional documents requested before this migration are each their own chain.
UPDATE "ApplicationDocument" SET "requestId" = "id" WHERE "requirementId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDocument_requestId_version_key" ON "ApplicationDocument"("requestId", "version");
