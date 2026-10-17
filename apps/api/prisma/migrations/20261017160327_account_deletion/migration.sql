-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "deletedAt" TIMESTAMP(3);
