-- M3.10: each document version points at the StoredFile it was uploaded as (one file backs one document,
-- and a file cannot be deleted while a version uses it). A replacement is version N+1 for the same
-- requirement; the unique index backs up the row lock in ApplicationDocumentsService.

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDocument_fileKey_key" ON "ApplicationDocument"("fileKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDocument_applicationId_requirementId_version_key" ON "ApplicationDocument"("applicationId", "requirementId", "version");

-- AddForeignKey
ALTER TABLE "ApplicationDocument" ADD CONSTRAINT "ApplicationDocument_fileKey_fkey" FOREIGN KEY ("fileKey") REFERENCES "StoredFile"("fileKey") ON DELETE RESTRICT ON UPDATE CASCADE;

