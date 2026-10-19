ALTER TABLE "CmsPage"
  ADD COLUMN "draftTitle" TEXT,
  ADD COLUMN "draftContent" JSONB,
  ADD COLUMN "draftSeoTitle" TEXT,
  ADD COLUMN "draftMetaDescription" TEXT,
  ADD COLUMN "draftOgImageUrl" TEXT,
  ADD COLUMN "draftContactEmail" TEXT,
  ADD COLUMN "draftContactPhone" TEXT;
