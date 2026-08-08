-- Keep channel calls idempotent under concurrent "start call" taps.
-- This lives after the enum-add migration so PostgreSQL can safely use CHANNEL_CALL
-- in the partial index predicate.

CREATE UNIQUE INDEX "AudioRoom_channelId_live_channel_call_key"
  ON "AudioRoom"("channelId")
  WHERE "channelId" IS NOT NULL
    AND "status" = 'LIVE'
    AND "type" = 'CHANNEL_CALL';
