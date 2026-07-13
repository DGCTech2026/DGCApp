-- Pre-start reminder marker for scheduled audio rooms
ALTER TABLE "AudioRoom" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
