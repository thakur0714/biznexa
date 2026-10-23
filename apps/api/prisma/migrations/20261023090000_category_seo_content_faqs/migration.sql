-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "seoContent" TEXT;

-- CreateTable
CREATE TABLE "CategoryFAQ" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoryFAQ_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CategoryFAQ" ADD CONSTRAINT "CategoryFAQ_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

