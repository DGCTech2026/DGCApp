-- Global Prayer Watch: new singleton channel type. Every user is auto-joined during onboarding
-- (users.service.onboardToBranch), and any member can start a live prayer audio call in it via
-- POST /api/v1/prayer-watch/start.

-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'GLOBAL_PRAYER_WATCH';
