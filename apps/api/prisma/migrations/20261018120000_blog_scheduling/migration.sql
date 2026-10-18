ALTER TYPE "PublishStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TABLE "BlogPost" ADD COLUMN "publishAt" TIMESTAMP(3);
CREATE TABLE "BlogPostCategory" (
  "postId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  CONSTRAINT "BlogPostCategory_pkey" PRIMARY KEY ("postId", "categoryId"),
  CONSTRAINT "BlogPostCategory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BlogPostCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "BlogPostCategory" ("postId", "categoryId") SELECT "id", "categoryId" FROM "BlogPost" WHERE "categoryId" IS NOT NULL;
