-- AlterEnum
ALTER TYPE "RequirementType" ADD VALUE 'URL_UPLOAD';

-- AlterTable
ALTER TABLE "RequirementCompletion" ADD COLUMN "fileUrl" TEXT;
