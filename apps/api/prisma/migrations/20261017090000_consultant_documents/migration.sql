CREATE TYPE "ConsultantDocumentKind" AS ENUM ('QUALIFICATION_PROOF', 'MEMBERSHIP_PROOF', 'ID_PROOF');

CREATE TABLE "ConsultantDocument" (
    "id" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "kind" "ConsultantDocumentKind" NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultantDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConsultantDocument_fileId_key" ON "ConsultantDocument"("fileId");
CREATE UNIQUE INDEX "ConsultantDocument_consultantId_kind_key" ON "ConsultantDocument"("consultantId", "kind");
CREATE INDEX "ConsultantDocument_consultantId_idx" ON "ConsultantDocument"("consultantId");

ALTER TABLE "ConsultantDocument" ADD CONSTRAINT "ConsultantDocument_consultantId_fkey"
    FOREIGN KEY ("consultantId") REFERENCES "Consultant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultantDocument" ADD CONSTRAINT "ConsultantDocument_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
