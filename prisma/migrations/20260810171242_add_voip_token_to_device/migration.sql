-- DropIndex
DROP INDEX "Message_body_trgm_idx";

-- DropIndex
DROP INDEX "Notification_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "DeviceToken" ADD COLUMN     "voipToken" TEXT;

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
