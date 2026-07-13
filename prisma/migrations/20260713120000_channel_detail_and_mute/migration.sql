-- Channel description
ALTER TABLE "Channel" ADD COLUMN "description" TEXT;

-- Mute support on membership
ALTER TABLE "ChannelMembership" ADD COLUMN "mutedAt" TIMESTAMP(3);
