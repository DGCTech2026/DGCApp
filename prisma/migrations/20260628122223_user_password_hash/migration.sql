-- AlterTable: optional password (OTP/OAuth accounts have none)
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT;
