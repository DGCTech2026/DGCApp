-- AlterEnum: announcements are a first-class notification category (PRD §12)
ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT';

-- AlterTable: announcements carry a title (null for normal chat messages)
ALTER TABLE "Message" ADD COLUMN "title" TEXT;
