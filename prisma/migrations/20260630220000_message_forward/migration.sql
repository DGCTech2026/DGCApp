-- AlterTable: mark a message as a forward of another (PRD §7 "Forward")
ALTER TABLE "Message" ADD COLUMN "forwardedFromId" TEXT;
