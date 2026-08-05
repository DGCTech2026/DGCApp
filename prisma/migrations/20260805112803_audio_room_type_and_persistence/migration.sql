-- Audio room variety + persistent-room support for the Prayer Watch feature (PRD §8 + clarification).
-- Prayer Watch rooms are the 24hr persistent audio room in the Prayer Warriors cluster; every user
-- receives a "prayer watch is live" push when a cluster moderator starts one.

-- CreateEnum
CREATE TYPE "AudioRoomType" AS ENUM ('GENERAL', 'PRAYER_WATCH');

-- AlterTable
ALTER TABLE "AudioRoom"
  ADD COLUMN "isPersistent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "type" "AudioRoomType" NOT NULL DEFAULT 'GENERAL';

-- CreateIndex — fast "is there a live prayer watch right now?" lookup, plus general type filtering.
CREATE INDEX "AudioRoom_type_status_idx" ON "AudioRoom"("type", "status");
