-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "requirementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_fileKey_key" ON "StoredFile"("fileKey");

-- CreateIndex
CREATE INDEX "StoredFile_ownerId_idx" ON "StoredFile"("ownerId");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ServiceDocumentRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
