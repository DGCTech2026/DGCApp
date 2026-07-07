-- AlterTable: track whether the pre-event reminder has already been sent to attendees (PRD §9)
ALTER TABLE "Event" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
