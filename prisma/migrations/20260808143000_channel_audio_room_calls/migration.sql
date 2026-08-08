-- Channel-scoped group calls: persistent AudioRoom sessions attached to a chat channel.
-- Unlike Global Prayer Watch, ringing/push fan-out is limited to the channel members.

ALTER TYPE "AudioRoomType" ADD VALUE 'CHANNEL_CALL';

ALTER TABLE "AudioRoom"
  ADD COLUMN "channelId" TEXT;

CREATE INDEX "AudioRoom_channelId_status_idx" ON "AudioRoom"("channelId", "status");

ALTER TABLE "AudioRoom"
  ADD CONSTRAINT "AudioRoom_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
