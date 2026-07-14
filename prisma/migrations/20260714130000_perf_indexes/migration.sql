-- Performance indexes (audit 2026-07-14).
-- Note: the trigram + partial indexes below can't be expressed in schema.prisma; this project
-- uses `migrate deploy` only, so they are safe from `migrate dev` drift.

-- Message search uses ILIKE '%term%' — trigram GIN makes it index-backed instead of a full scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Message_body_trgm_idx" ON "Message" USING GIN ("body" gin_trgm_ops);

-- Notifications list: WHERE userId ORDER BY createdAt DESC (existing index only covers unread count).
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- Pinned messages: tiny partial index — only pinned rows are indexed.
CREATE INDEX IF NOT EXISTS "Message_channelId_pinnedAt_idx" ON "Message"("channelId", "pinnedAt" DESC)
  WHERE "pinnedAt" IS NOT NULL;

-- Audio room queries always filter (roomId, leftAt IS NULL).
CREATE INDEX IF NOT EXISTS "AudioRoomParticipant_roomId_leftAt_idx" ON "AudioRoomParticipant"("roomId", "leftAt");
